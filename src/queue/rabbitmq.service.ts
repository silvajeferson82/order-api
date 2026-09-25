import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Channel, ChannelModel } from 'amqplib';
import { OrderCreatedEvent } from '../application/ports/order-event-publisher.port';

@Injectable()
export class OrderQueuePublisher implements OnModuleInit {
  private readonly logger = new Logger(OrderQueuePublisher.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  async onModuleInit(): Promise<void> {
    if (process.env.RABBITMQ_ENABLED === 'false') {
      this.logger.warn(
        'RabbitMQ desabilitado. O pedido será salvo sem publicação em fila.',
      );
      return;
    }

    try {
      const amqp = await import('amqplib');
      this.connection = await amqp.connect(
        process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
      );
      this.channel = await this.connection.createChannel();
      await this.channel.assertQueue('order.created', { durable: true });
      this.logger.log('Conectado ao RabbitMQ');
    } catch {
      this.logger.warn(
        'RabbitMQ indisponível; a fila ficou inativa para esta execução.',
      );
    }
  }

  publishOrderCreated(event: OrderCreatedEvent): void {
    if (!this.channel) {
      this.logger.warn(
        `Mensagem de pedido ${event.orderId} não publicada em fila. RabbitMQ indisponível.`,
      );
      return;
    }

    this.channel.sendToQueue(
      'order.created',
      Buffer.from(JSON.stringify(event)),
      { persistent: true },
    );
  }
}
