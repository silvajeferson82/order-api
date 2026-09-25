import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OrderCreatedEvent } from '../application/ports/order-event-publisher.port';
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
          if (record.eventType !== 'order.created') {
            throw new Error(
              `Tipo de evento não suportado: ${record.eventType}`,
            );
          }
          await this.publisher.publishOrderCreated(
            record.payload as OrderCreatedEvent,
          );
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}
