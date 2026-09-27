import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { Repository } from 'typeorm';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();
  readonly httpRequests: Counter<string>;
  readonly httpDuration: Histogram<string>;
  readonly processingResults: Counter<string>;
  readonly processingDuration: Histogram<string>;
  readonly outboxPending = new Gauge({
    name: 'order_outbox_pending',
    help: 'Quantidade de eventos ainda não publicados na outbox.',
    registers: [],
  });
  readonly outboxOldestAge = new Gauge({
    name: 'order_outbox_oldest_pending_age_seconds',
    help: 'Idade em segundos do evento pendente mais antigo.',
    registers: [],
  });
  readonly outboxAttempts: Counter<string>;
  readonly consumerResults: Counter<string>;
  private refreshTimer: NodeJS.Timeout;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
  ) {
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.processingResults = new Counter({
      name: 'order_processing_results_total',
      help: 'Resultados finais do processamento de pedidos.',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.processingDuration = new Histogram({
      name: 'order_processing_duration_seconds',
      help: 'Duração dos processamentos.',
      labelNames: ['status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300],
      registers: [this.registry],
    });
    this.outboxAttempts = new Counter({
      name: 'order_outbox_publication_attempts_total',
      help: 'Tentativas de publicação da outbox.',
      registers: [this.registry],
    });
    this.consumerResults = new Counter({
      name: 'order_consumer_results_total',
      help: 'Resultados do consumer por classe.',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.registry.registerMetric(this.outboxPending);
    this.registry.registerMetric(this.outboxOldestAge);
    this.refreshTimer = setInterval(() => void this.refreshOutbox(), 15_000);
    this.refreshTimer.unref();
    void this.refreshOutbox();
  }

  async refreshOutbox(): Promise<void> {
    try {
      const result = await this.outbox
        .createQueryBuilder('outbox')
        .select('COUNT(*)', 'pending')
        .addSelect('MIN(outbox.createdAt)', 'oldest')
        .where('outbox.publishedAt IS NULL')
        .getRawOne<{ pending: string; oldest: Date | string | null }>();
      this.outboxPending.set(Number(result?.pending ?? 0));
      const oldest = result?.oldest ? new Date(result.oldest).getTime() : 0;
      this.outboxOldestAge.set(
        oldest ? Math.max(0, (Date.now() - oldest) / 1000) : 0,
      );
    } catch {
      // Métricas nunca devem derrubar o fluxo funcional quando o banco oscila.
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }
}
