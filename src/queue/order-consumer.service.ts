import {
  NotFoundException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { OrdersService } from '../application/orders.service';
import { OrderQueuePublisher } from './rabbitmq.service';
import {
  classifyProcessingFailure,
  InvalidOrderEventError,
  retryQueueFor,
} from './retry-policy';

@Injectable()
export class OrderConsumerService implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumerService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly queue: OrderQueuePublisher,
  ) {}

  onModuleInit(): void {
    this.queue.registerConsumer((channel) => this.startConsumer(channel));
  }

  private async startConsumer(channel: ConfirmChannel): Promise<void> {
    await channel.prefetch(1);
    await channel.consume('order.created', (message) => {
      void this.processMessage(message, channel);
    });
  }

  private async processMessage(
    message: ConsumeMessage | null,
    channel: ConfirmChannel,
  ): Promise<void> {
    if (!message) return;
    if (channel !== this.queue.getChannel()) return;
    let orderId: number | null = null;
    try {
      const payload = parseOrderCreatedMessage(message);
      orderId = payload.orderId;
      const order = await this.ordersService.findOne(orderId);
      if (order.status === 'PROCESSED' || order.status === 'FAILED') {
        channel.ack(message);
        return;
      }
      await this.ordersService.reserveProductsForOrder(order.id);
      channel.ack(message);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'erro desconhecido';
      let classification = classifyProcessingFailure(error);
      if (classification === 'PERMANENT' && orderId !== null) {
        try {
          await this.ordersService.updateOrderStatus(orderId, 'FAILED', reason);
        } catch (statusError) {
          // A falha ao persistir o resultado é transitória: não descarte a mensagem.
          classification =
            statusError instanceof NotFoundException
              ? 'PERMANENT'
              : 'TRANSIENT';
        }
      }
      const retries = parseRetryCount(
        message.properties.headers?.['x-retry-count'],
      );
      const retryQueue =
        classification === 'TRANSIENT' ? retryQueueFor(retries) : null;
      if (retryQueue) {
        try {
          await this.queue.publishRetry(retryQueue, message.content, {
            ...message.properties.headers,
            'x-retry-count': retries + 1,
          });
          channel.ack(message);
          return;
        } catch (publishError) {
          this.logger.error(
            `Não foi possível publicar retry: ${errorMessage(publishError)}`,
          );
          channel.nack(message, false, true);
          return;
        }
      }
      if (classification === 'TRANSIENT' && orderId !== null) {
        try {
          await this.ordersService.updateOrderStatus(orderId, 'FAILED', reason);
        } catch (statusError) {
          if (statusError instanceof NotFoundException) {
            channel.nack(message, false, false);
            return;
          }
          this.logger.error(
            `Não foi possível marcar pedido ${orderId} como FAILED: ${errorMessage(statusError)}`,
          );
          channel.nack(message, false, true);
          return;
        }
      }
      channel.nack(message, false, false);
      this.logger.error(
        `Pedido ${orderId ?? 'desconhecido'} falhou: ${reason}`,
      );
    }
  }
}

type OrderCreatedMessage = { orderId: number };

function parseOrderCreatedMessage(
  message: ConsumeMessage,
): OrderCreatedMessage {
  let value: unknown;
  try {
    value = JSON.parse(message.content.toString());
  } catch {
    throw new InvalidOrderEventError();
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('orderId' in value) ||
    typeof value.orderId !== 'number' ||
    !Number.isInteger(value.orderId) ||
    value.orderId < 1
  ) {
    throw new InvalidOrderEventError();
  }
  return { orderId: value.orderId };
}

function parseRetryCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}
