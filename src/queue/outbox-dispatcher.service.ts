import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { DomainEvent } from '../domain/orders/events/domain-event';
import { OrderCreatedEvent } from '../domain/orders/events/order-created.event';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';
import { OrderQueuePublisher } from './rabbitmq.service';

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
    private readonly publisher: OrderQueuePublisher,
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
        try {
          const event = domainEventFromOutbox(record.eventType, record.payload);
          await this.publisher.publishDomainEvent(event);
          await this.outbox.update(
            { id: record.id, publishedAt: IsNull() },
            { publishedAt: new Date() },
          );
        } catch (error) {
          await this.outbox.increment({ id: record.id }, 'attempts', 1);
          this.logger.error(
            `Falha ao publicar evento outbox ${record.eventId}: ${messageOf(error)}`,
          );
          // Preserva a ordem de publicação e tenta novamente no próximo ciclo.
          break;
        }
      }
    } catch (error) {
      this.logger.error(`Falha ao consultar outbox: ${messageOf(error)}`);
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}
