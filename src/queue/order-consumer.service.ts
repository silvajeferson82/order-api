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
    let generation: number | null = null;
    let processingRun: number | null = null;
    try {
      const payload = parseOrderCreatedMessage(message);
      orderId = payload.orderId;
      generation = payload.generation;
      processingRun = payload.processingRun;
      const order = await this.ordersService.findOne(orderId);
      if (
        order.generation !== generation ||
        order.processingRun !== processingRun ||
        order.status === 'PROCESSED' ||
        order.status === 'FAILED'
      ) {
        channel.ack(message);
        return;
      }
      const started = await this.ordersService.startProcessingRun(
        order.id,
        generation,
        processingRun,
      );
      if (!started) {
        channel.ack(message);
        return;
      }
      await this.ordersService.reserveGeneration(
        order.id,
        generation,
        processingRun,
      );
      channel.ack(message);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'erro desconhecido';
      let classification = classifyProcessingFailure(error);
      if (
        classification === 'PERMANENT' &&
        orderId !== null &&
        generation !== null &&
        processingRun !== null
      ) {
        try {
          const updated =
            await this.ordersService.updateOrderStatusForGeneration(
              orderId,
              generation,
              processingRun,
              'FAILED',
              reason,
            );
          if (!updated) {
            try {
              await this.ordersService.findOne(orderId);
              channel.ack(message);
              return;
            } catch (lookupError) {
              if (!(lookupError instanceof NotFoundException))
                throw lookupError;
            }
          }
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
      if (
        classification === 'TRANSIENT' &&
        orderId !== null &&
        generation !== null &&
        processingRun !== null
      ) {
        try {
          const updated =
            await this.ordersService.updateOrderStatusForGeneration(
              orderId,
              generation,
              processingRun,
              'FAILED',
              reason,
            );
          if (!updated) {
            try {
              await this.ordersService.findOne(orderId);
              channel.ack(message);
              return;
            } catch (lookupError) {
              if (!(lookupError instanceof NotFoundException))
                throw lookupError;
            }
          }
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

type OrderCreatedMessage = {
  eventType: 'order.created' | 'order.reprocess.requested';
  version: 1;
  orderId: number;
  generation: number;
  processingRun: number;
};

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
    !('eventType' in value) ||
    (value.eventType !== 'order.created' &&
      value.eventType !== 'order.reprocess.requested') ||
    !('version' in value) ||
    value.version !== 1 ||
    !('orderId' in value) ||
    typeof value.orderId !== 'number' ||
    !Number.isInteger(value.orderId) ||
    value.orderId < 1 ||
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !Number.isInteger(value.generation) ||
    value.generation < 1 ||
    !('processingRun' in value) ||
    typeof value.processingRun !== 'number' ||
    !Number.isInteger(value.processingRun) ||
    value.processingRun < 1
  ) {
    throw new InvalidOrderEventError();
  }
  return {
    eventType: value.eventType,
    version: 1,
    orderId: value.orderId,
    generation: value.generation,
    processingRun: value.processingRun,
  };
}

function parseRetryCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}
