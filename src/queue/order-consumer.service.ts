import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { OrdersService } from '../application/orders.service';
import { OrderQueuePublisher } from './rabbitmq.service';

const MAX_RETRIES = 3;

@Injectable()
export class OrderConsumerService implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumerService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly queue: OrderQueuePublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.queue.getChannel();
    if (!channel) return;
    await channel.prefetch(1);
    await channel.consume('order.created', (message) => {
      void this.processMessage(message);
    });
  }

  private async processMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) return;
    const channel = this.queue.getChannel();
    if (!channel) return;
    let orderId: number | null = null;
    try {
      const payload = parseOrderCreatedMessage(message);
      orderId = payload.orderId;
      const order = await this.ordersService.findOne(orderId);
      if (order.status === 'PROCESSED') {
        channel.ack(message);
        return;
      }
      await this.ordersService.reserveProductsForOrder(order.id);
      channel.ack(message);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'erro desconhecido';
      const retries = Number(
        message.properties.headers?.['x-retry-count'] ?? 0,
      );
      if (retries < MAX_RETRIES) {
        channel.sendToQueue('order.created', message.content, {
          persistent: true,
          headers: {
            ...message.properties.headers,
            'x-retry-count': retries + 1,
          },
        });
        channel.ack(message);
      } else {
        if (orderId !== null) {
          await this.ordersService.updateOrderStatus(orderId, 'FAILED', reason);
        }
        channel.nack(message, false, false);
      }
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
  const value: unknown = JSON.parse(message.content.toString());
  if (
    typeof value !== 'object' ||
    value === null ||
    !('orderId' in value) ||
    typeof value.orderId !== 'number' ||
    !Number.isInteger(value.orderId) ||
    value.orderId < 1
  ) {
    throw new Error('Evento order.created inválido');
  }
  return { orderId: value.orderId };
}
