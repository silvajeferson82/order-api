import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ChannelModel } from 'amqplib';
import { OrderCreatedEvent } from '../application/ports/order-event-publisher.port';

@Injectable()
export class OrderQueuePublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderQueuePublisher.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connecting = false;
  private enabled = false;
  private url: string | undefined;
  private readonly consumers: Array<
    (channel: ConfirmChannel) => Promise<void>
  > = [];

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
    this.enabled = true;
    this.url = this.config.getOrThrow<string>('RABBITMQ_URL');
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.connecting || !this.enabled || !this.url) return;
    this.connecting = true;
    let connection: ChannelModel | undefined;
    try {
      const amqp = await import('amqplib');
      connection = await amqp.connect(this.url);
      this.connection = connection;
      connection.on('error', (error: Error) => {
        this.logger.error(`Conexão RabbitMQ: ${error.message}`);
      });
      connection.on('close', () => this.handleDisconnect());
      const channel = await connection.createConfirmChannel();
      this.channel = channel;
      channel.on('error', (error: Error) => {
        this.logger.error(`Canal RabbitMQ: ${error.message}`);
      });
      channel.on('close', () => this.handleDisconnect());
      await channel.assertExchange('order.created.dlq', 'fanout', {
        durable: true,
      });
      await channel.assertQueue('order.created', {
        durable: true,
        deadLetterExchange: 'order.created.dlq',
        deadLetterRoutingKey: 'order.created.dlq',
      });
      await channel.assertQueue('order.created.dlq', { durable: true });
      await channel.bindQueue('order.created.dlq', 'order.created.dlq', '');
      for (const [index, delay] of [1000, 5000, 15000].entries()) {
        await channel.assertQueue(`order.created.retry.${index + 1}`, {
          durable: true,
          messageTtl: delay,
          deadLetterExchange: '',
          deadLetterRoutingKey: 'order.created',
        });
      }
      for (const register of this.consumers) await register(channel);
      this.logger.log('Conectado ao RabbitMQ');
    } catch (error) {
      this.channel = null;
      this.connection = null;
      if (connection) await connection.close().catch(() => undefined);
      this.logger.error(
        `Conexão RabbitMQ indisponível: ${messageOf(error)}; haverá nova tentativa.`,
      );
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  registerConsumer(register: (channel: ConfirmChannel) => Promise<void>): void {
    this.consumers.push(register);
    if (this.channel) {
      void register(this.channel).catch((error: unknown) => {
        this.logger.error(`Falha ao registrar consumer: ${messageOf(error)}`);
      });
    }
  }

  private handleDisconnect(): void {
    this.channel = null;
    this.connection = null;
    if (this.enabled) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 2000);
    this.reconnectTimer.unref();
  }

  getChannel(): ConfirmChannel | null {
    return this.channel;
  }

  async publishOrderCreated(event: OrderCreatedEvent): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ indisponível para publicação do evento');
    }
    this.channel.sendToQueue(
      'order.created',
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json' },
    );
    await this.channel.waitForConfirms();
  }

  async publishRetry(
    retryQueue: string,
    content: Buffer,
    headers: Record<string, unknown>,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ indisponível para retry');
    this.channel.sendToQueue(retryQueue, content, {
      persistent: true,
      contentType: 'application/json',
      headers,
    });
    await this.channel.waitForConfirms();
  }

  async onModuleDestroy(): Promise<void> {
    this.enabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}
