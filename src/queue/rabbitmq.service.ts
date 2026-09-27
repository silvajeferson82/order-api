import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ChannelModel } from 'amqplib';
import type { DomainEvent } from '../domain/orders/events/domain-event';
import { propagation, context } from '@opentelemetry/api';
import { logEvent } from '../observability/json-logger';

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
        logEvent('error', 'rabbitmq.connection.error', {
          errorType: error.name,
        });
      });
      connection.on('close', () => this.handleDisconnect());
      const channel = await connection.createConfirmChannel();
      this.channel = channel;
      channel.on('error', (error: Error) => {
        logEvent('error', 'rabbitmq.channel.error', {
          errorType: error.name,
        });
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
      logEvent('error', 'rabbitmq.connection.unavailable', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        reconnectInSeconds: 2,
      });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  registerConsumer(register: (channel: ConfirmChannel) => Promise<void>): void {
    this.consumers.push(register);
    if (this.channel) {
      void register(this.channel).catch((error: unknown) => {
        logEvent('error', 'rabbitmq.consumer.registration_failed', {
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
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

  async publishDomainEvent(event: DomainEvent): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ indisponível para publicação do evento');
    }
    const headers: Record<string, unknown> = {
      ...(event.eventId ? { eventId: event.eventId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
    };
    propagation.inject(context.active(), headers);
    this.channel.sendToQueue(
      'order.created',
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json', headers },
    );
    await this.channel.waitForConfirms();
    logEvent('info', 'outbox.event.published', {
      eventId: event.eventId,
      requestId: event.requestId,
      orderId: event.orderId,
      generation: event.generation,
      processingRun: event.processingRun,
      eventType: event.eventType,
    });
  }

  async publishRetry(
    retryQueue: string,
    content: Buffer,
    headers: Record<string, unknown>,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ indisponível para retry');
    const propagationHeaders: Record<string, unknown> = { ...headers };
    propagation.inject(context.active(), propagationHeaders);
    this.channel.sendToQueue(retryQueue, content, {
      persistent: true,
      contentType: 'application/json',
      headers: propagationHeaders,
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
