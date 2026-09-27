import {
  NotFoundException,
  Inject,
  Injectable,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Span,
} from '@opentelemetry/api';
import { OrdersService } from '../application/orders.service';
import { OrderQueuePublisher } from './rabbitmq.service';
import type { MetricsService } from '../observability/metrics.service';
import { METRICS_SERVICE } from '../observability/metrics.token';
import { requestContext } from '../observability/request-context';
import { isValidRequestId } from '../observability/request-id';
import { logEvent } from '../observability/json-logger';
import { errorDiagnostics } from '../observability/error-diagnostics';
import {
  classifyProcessingFailure,
  InvalidOrderEventError,
  retryQueueFor,
} from './retry-policy';

@Injectable()
export class OrderConsumerService implements OnModuleInit {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly queue: OrderQueuePublisher,
    @Optional()
    @Inject(METRICS_SERVICE)
    private readonly metrics?: MetricsService,
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
    let envelope: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(message.content.toString());
      if (typeof parsed === 'object' && parsed !== null)
        envelope = parsed as Record<string, unknown>;
    } catch {
      // A validação completa e o roteamento para DLQ ocorrem no handler.
    }
    const rawHeaders: unknown = message.properties.headers;
    const headers: Record<string, unknown> =
      typeof rawHeaders === 'object' && rawHeaders !== null
        ? (rawHeaders as Record<string, unknown>)
        : {};
    const requestId = isValidRequestId(headers.requestId)
      ? headers.requestId
      : isValidRequestId(envelope.requestId)
        ? envelope.requestId
        : undefined;
    const contextFields = {
      ...(requestId ? { requestId } : {}),
      ...(typeof envelope.orderId === 'number'
        ? { orderId: envelope.orderId }
        : {}),
      ...(typeof envelope.generation === 'number'
        ? { generation: envelope.generation }
        : {}),
      ...(typeof envelope.processingRun === 'number'
        ? { processingRun: envelope.processingRun }
        : {}),
      ...(typeof headers.eventId === 'string'
        ? { eventId: headers.eventId }
        : typeof envelope.eventId === 'string'
          ? { eventId: envelope.eventId }
          : {}),
      ...(typeof envelope.eventType === 'string'
        ? { eventType: envelope.eventType }
        : {}),
    };
    const carrier: Record<string, string> = {};
    for (const key of ['traceparent', 'tracestate', 'baggage']) {
      const value = headers[key];
      if (typeof value === 'string') carrier[key] = value;
    }
    const parent = propagation.extract(context.active(), carrier);
    const startedAt = Date.now();
    const tracer = trace.getTracer('order-api.consumer');
    await context.with(parent, () =>
      tracer.startActiveSpan('order.process', async (span) => {
        try {
          if (contextFields.requestId)
            span.setAttribute('request.id', contextFields.requestId);
          if (contextFields.eventId)
            span.setAttribute('messaging.message.id', contextFields.eventId);
          if (contextFields.orderId !== undefined)
            span.setAttribute('order.id', contextFields.orderId);
          if (contextFields.generation !== undefined)
            span.setAttribute('order.generation', contextFields.generation);
          if (contextFields.processingRun !== undefined)
            span.setAttribute(
              'order.processing_run',
              contextFields.processingRun,
            );
          await requestContext.run(contextFields, () =>
            this.handleMessage(message, channel, startedAt, span),
          );
        } finally {
          span.end();
        }
      }),
    );
  }

  private async handleMessage(
    message: ConsumeMessage,
    channel: ConfirmChannel,
    startedAt: number,
    span: Span,
  ): Promise<void> {
    let orderId: number | null = null;
    let generation: number | null = null;
    let processingRun: number | null = null;
    try {
      const payload = parseOrderCreatedMessage(message);
      orderId = payload.orderId;
      generation = payload.generation;
      processingRun = payload.processingRun;
      logEvent('info', 'consumer.attempt.started', {
        orderId,
        generation,
        processingRun,
        eventType: payload.eventType,
        attempt:
          parseRetryCount(message.properties.headers?.['x-retry-count']) + 1,
      });
      const order = await this.ordersService.findOne(orderId);
      if (
        order.generation !== generation ||
        order.processingRun !== processingRun ||
        order.status === 'PROCESSED' ||
        order.status === 'FAILED'
      ) {
        channel.ack(message);
        this.metrics?.consumerResults.inc({ result: 'stale' });
        logEvent('info', 'consumer.message.stale', {
          orderId,
          generation,
          processingRun,
          eventType: payload.eventType,
        });
        return;
      }
      const started = await this.ordersService.startProcessingRun(
        order.id,
        generation,
        processingRun,
      );
      if (!started) {
        channel.ack(message);
        this.metrics?.consumerResults.inc({ result: 'stale' });
        return;
      }
      await this.ordersService.reserveGeneration(
        order.id,
        generation,
        processingRun,
      );
      channel.ack(message);
      this.metrics?.processingResults.inc({ status: 'PROCESSED' });
      this.metrics?.processingDuration.observe(
        { status: 'PROCESSED' },
        (Date.now() - startedAt) / 1000,
      );
      this.metrics?.consumerResults.inc({ result: 'success' });
      span.setAttribute('order.status', 'PROCESSED');
      logEvent('info', 'consumer.attempt.succeeded', {
        orderId,
        generation,
        processingRun,
        eventType: payload.eventType,
      });
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
          this.metrics?.consumerResults.inc({ result: 'retry' });
          logEvent('warn', 'consumer.attempt.retry_scheduled', {
            orderId,
            generation,
            processingRun,
            retry: retries + 1,
            retryQueue,
          });
          return;
        } catch (publishError) {
          logEvent('error', 'consumer.retry.publish_failed', {
            orderId,
            generation,
            processingRun,
            retry: retries + 1,
            ...errorDiagnostics(publishError),
          });
          logEvent('warn', 'consumer.message.requeued', {
            orderId,
            generation,
            processingRun,
            requeue: true,
          });
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
            this.metrics?.consumerResults.inc({ result: 'dlq' });
            logEvent('error', 'consumer.attempt.failed', {
              orderId,
              generation,
              processingRun,
              failureClass: 'PERMANENT',
              destination: 'dead-letter-queue',
            });
            return;
          }
          logEvent('error', 'consumer.failure_persistence_failed', {
            orderId,
            generation,
            processingRun,
            requeue: true,
            ...errorDiagnostics(statusError),
          });
          channel.nack(message, false, true);
          return;
        }
      }
      channel.nack(message, false, false);
      this.metrics?.consumerResults.inc({ result: 'dlq' });
      this.metrics?.processingResults.inc({ status: 'FAILED' });
      this.metrics?.processingDuration.observe(
        { status: 'FAILED' },
        (Date.now() - startedAt) / 1000,
      );
      this.metrics?.consumerResults.inc({ result: 'failure' });
      span.setStatus({ code: SpanStatusCode.ERROR });
      logEvent('error', 'consumer.attempt.failed', {
        orderId,
        generation,
        processingRun,
        failureClass: classification,
        destination: 'dead-letter-queue',
        ...errorDiagnostics(error),
      });
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
