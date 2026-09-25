import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ChannelModel } from 'amqplib';
import { OrderCreatedEvent } from '../application/ports/order-event-publisher.port';

@Injectable()
export class OrderQueuePublisher implements OnModuleInit {
  private readonly logger = new Logger(OrderQueuePublisher.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<boolean | string>(
      'RABBITMQ_ENABLED',
      false,
    );
    if (enabled !== true && enabled !== 'true') {
      this.logger.warn('RabbitMQ desabilitado.');
      return;
    }
    const url = this.config.getOrThrow<string>('RABBITMQ_URL');
    const amqp = await import('amqplib');
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange('order.created.dlq', 'fanout', {
      durable: true,
    });
    await this.channel.assertQueue('order.created', {
      durable: true,
      deadLetterExchange: 'order.created.dlq',
    });
    await this.channel.assertQueue('order.created.dlq', { durable: true });
    await this.channel.bindQueue('order.created.dlq', 'order.created.dlq', '');
    this.logger.log('Conectado ao RabbitMQ');
  }

  getChannel(): Channel | null {
    return this.channel;
  }

  publishOrderCreated(event: OrderCreatedEvent): void {
    if (!this.channel) {
      this.logger.warn(
        `Pedido ${event.orderId} não publicado: fila indisponível.`,
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
