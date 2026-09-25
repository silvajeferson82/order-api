import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class OrderConsumerService implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumerService.name);
  private channel: Channel | null = null;

  constructor(private readonly ordersService: OrdersService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RABBITMQ_ENABLED === 'false') {
      return;
    }

    try {
      const amqp = await import('amqplib');
      const connection: ChannelModel = await amqp.connect(
        process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
      );
      this.channel = await connection.createChannel();
      await this.channel.assertQueue('order.created', { durable: true });

      await this.channel.consume(
        'order.created',
        (message: ConsumeMessage | null) => {
          void this.processMessage(message);
        },
      );
    } catch {
      this.logger.warn(
        'Consumer do RabbitMQ não iniciou. A execução seguirá sem fila ativa.',
      );
    }
  }

  private async processMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }

    let orderId: number | null = null;
    try {
      const payload = parseOrderCreatedMessage(message);
      orderId = payload.orderId;
      const order = await this.ordersService.findOne(orderId);

      if (order.status === 'PROCESSED') {
        this.channel?.ack(message);
        return;
      }

      await this.ordersService.reserveProductsForOrder(order.id);
      await this.ordersService.updateOrderStatus(order.id, 'PROCESSED');
      this.channel?.ack(message);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'erro desconhecido';
      if (orderId !== null) {
        await this.ordersService.updateOrderStatus(orderId, 'FAILED', reason);
      }
      this.channel?.ack(message);
      this.logger.error(
        `Pedido ${orderId ?? 'desconhecido'} falhou: ${reason}`,
      );
    }
  }
}

type OrderCreatedMessage = {
  orderId: number;
};

function parseOrderCreatedMessage(
  message: ConsumeMessage,
): OrderCreatedMessage {
  const value: unknown = JSON.parse(message.content.toString());

  if (
    typeof value !== 'object' ||
    value === null ||
    !('orderId' in value) ||
    typeof value.orderId !== 'number'
  ) {
    throw new Error('Evento order.created inválido');
  }

  return { orderId: value.orderId };
}
