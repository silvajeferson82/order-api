import {
  Injectable,
  Inject,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { DomainEvent } from '../domain/orders/events/domain-event';
import { OrderCreatedEvent } from '../domain/orders/events/order-created.event';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';
import { OrderQueuePublisher } from './rabbitmq.service';
import type { MetricsService } from '../observability/metrics.service';
import { METRICS_SERVICE } from '../observability/metrics.token';
import { requestContext } from '../observability/request-context';
import { isValidRequestId } from '../observability/request-id';
import { logEvent } from '../observability/json-logger';
import { errorDiagnostics } from '../observability/error-diagnostics';
import { context, propagation, trace } from '@opentelemetry/api';

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
    private readonly publisher: OrderQueuePublisher,
    @Optional()
    @Inject(METRICS_SERVICE)
    private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchPending();
    }, 1000);
    this.timer.unref();
    void this.dispatchPending();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchPending(): Promise<void> {
    if (this.dispatching || !this.publisher.getChannel()) return;
    this.dispatching = true;
    try {
      const pending = await this.outbox.find({
        where: { publishedAt: IsNull() },
        order: { id: 'ASC' },
        take: 20,
      });
      for (const record of pending) {
        this.metrics?.outboxAttempts.inc();
        let event: DomainEvent | undefined;
        try {
          const storedRequestId =
            record.requestId ??
            (typeof record.payload.requestId === 'string'
              ? record.payload.requestId
              : undefined);
          const currentEvent = {
            ...domainEventFromOutbox(record.eventType, record.payload),
            eventId: record.eventId,
            ...(isValidRequestId(storedRequestId)
              ? { requestId: storedRequestId }
              : {}),
            traceparent:
              record.traceparent ??
              (typeof record.payload.traceparent === 'string'
                ? record.payload.traceparent
                : undefined),
            tracestate:
              record.tracestate ??
              (typeof record.payload.tracestate === 'string'
                ? record.payload.tracestate
                : undefined),
          };
          event = currentEvent;
          const tracer = trace.getTracer('order-api.outbox');
          const parent = propagation.extract(context.active(), {
            ...(currentEvent.traceparent
              ? { traceparent: currentEvent.traceparent }
              : {}),
            ...(currentEvent.tracestate
              ? { tracestate: currentEvent.tracestate }
              : {}),
          });
          await requestContext.run(
            {
              ...(currentEvent.requestId
                ? { requestId: currentEvent.requestId }
                : {}),
              orderId: currentEvent.orderId,
              generation: currentEvent.generation,
              processingRun: currentEvent.processingRun,
              eventId: currentEvent.eventId,
              eventType: currentEvent.eventType,
            },
            () =>
              context.with(parent, () =>
                tracer.startActiveSpan('outbox.publish', async (span) => {
                  span.setAttribute('messaging.message.id', record.eventId);
                  span.setAttribute(
                    'messaging.destination.name',
                    'order.created',
                  );
                  try {
                    await this.publisher.publishDomainEvent(currentEvent);
                  } finally {
                    span.end();
                  }
                }),
              ),
          );
          await this.outbox.update(
            { id: record.id, publishedAt: IsNull() },
            { publishedAt: new Date() },
          );
        } catch (error) {
          await this.outbox.increment({ id: record.id }, 'attempts', 1);
          logEvent('error', 'outbox.event.publish_failed', {
            eventId: record.eventId,
            requestId: record.requestId ?? event?.requestId,
            orderId: event?.orderId,
            generation: event?.generation,
            processingRun: event?.processingRun,
            eventType: event?.eventType ?? record.eventType,
            attempts: record.attempts + 1,
            ...errorDiagnostics(error),
          });
          // Preserva a ordem de publicação e tenta novamente no próximo ciclo.
          break;
        }
      }
    } catch (error) {
      logEvent(
        'error',
        'outbox.dispatch.query_failed',
        errorDiagnostics(error),
      );
    } finally {
      this.dispatching = false;
    }
  }
}

function domainEventFromOutbox(
  eventType: string,
  payload: Record<string, unknown>,
): DomainEvent {
  if (
    eventType === 'order.created' &&
    payload.version === undefined &&
    Number.isInteger(payload.orderId) &&
    Number(payload.orderId) > 0
  ) {
    // Compatibilidade com mensagens criadas antes da adoção do contrato v1.
    return new OrderCreatedEvent(Number(payload.orderId), 1, 1);
  }
  if (
    (eventType === 'order.created' ||
      eventType === 'order.reprocess.requested') &&
    payload.eventType === eventType &&
    payload.version === 1 &&
    Number.isInteger(payload.orderId) &&
    Number(payload.orderId) > 0 &&
    Number.isInteger(payload.generation) &&
    Number(payload.generation) > 0 &&
    Number.isInteger(payload.processingRun) &&
    Number(payload.processingRun) > 0
  ) {
    return payload as unknown as DomainEvent;
  }
  throw new Error(`Evento outbox inválido ou não suportado: ${eventType}`);
}
