import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import type { Order, OrderDraft } from '../../domain/orders/order';
import type { OrderRepository } from '../../domain/orders/order-repository';
import { OrderEntity } from '../database/entities/order.entity';
import { ProductEntity } from '../database/entities/product.entity';
import { OutboxEventEntity } from '../database/entities/outbox-event.entity';
import { OrderProcessingRunEntity } from '../database/entities/order-processing-run.entity';
import type { OrderProcessingRunSource } from '../database/entities/order-processing-run.entity';
import { toOrder, toOrderEntity, toOrderDraft } from './order.mapper';
import { InsufficientStockError } from '../../domain/products/insufficient-stock.error';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  OrderNotFoundError,
  OrderNotReprocessableError,
} from '../../domain/orders/order-errors';
import type { DomainEvent } from '../../domain/orders/events/domain-event';
import { requestContext } from '../../observability/request-context';
import { context, propagation } from '@opentelemetry/api';

export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly repository: Repository<OrderEntity>,
    private readonly dataSource: DataSource,
  ) {}

  create(order: OrderDraft): OrderDraft {
    return toOrderDraft(order);
  }

  async createWithEvent(
    order: OrderDraft,
    eventFor: (savedOrder: Order) => DomainEvent,
    requestedBy?: string | null,
  ): Promise<Order> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const entity = await manager
        .getRepository(OrderEntity)
        .save(toOrderEntity(order));
      const event = eventFor(toOrder(entity));
      const eventId = await this.insertOutboxEvent(manager, event);
      await this.insertProcessingRun(manager, {
        orderId: entity.id,
        generation: entity.generation,
        processingRun: entity.processingRun,
        source: 'CREATE',
        eventId,
        eventType: event.eventType,
        requestedBy,
      });
      return entity;
    });
    return toOrder(saved);
  }

  async reprocessFailed(
    id: number,
    eventFor: (savedOrder: Order) => DomainEvent,
    requestedBy?: string | null,
  ): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(OrderEntity);
      const entity = await orders.findOne({
        where: { id },
        relations: ['items'],
        ...(this.dataSource.options.type === 'mysql'
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (!entity) throw new OrderNotFoundError(id);
      if (entity.status !== 'FAILED') {
        throw new OrderNotReprocessableError(id);
      }

      entity.status = 'PENDING';
      entity.failureReason = null;
      entity.generation += 1;
      entity.processingRun += 1;
      const saved = await orders.save(entity);
      const order = toOrder(saved);
      const event = eventFor(order);
      const eventId = await this.insertOutboxEvent(manager, event);
      await this.insertProcessingRun(manager, {
        orderId: saved.id,
        generation: saved.generation,
        processingRun: saved.processingRun,
        source: 'MANUAL',
        eventId,
        eventType: event.eventType,
        requestedBy,
      });
      return order;
    });
  }

  private async insertOutboxEvent(
    manager: EntityManager,
    event: DomainEvent,
  ): Promise<string> {
    const eventId = randomUUID();
    const currentContext = requestContext.current();
    if (currentContext) {
      currentContext.eventId = eventId;
      currentContext.eventType = event.eventType;
    }
    const requestId = event.requestId ?? requestContext.current()?.requestId;
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);
    const traceparent =
      typeof traceContext.traceparent === 'string'
        ? traceContext.traceparent
        : undefined;
    const tracestate =
      typeof traceContext.tracestate === 'string'
        ? traceContext.tracestate
        : undefined;
    await manager.getRepository(OutboxEventEntity).insert({
      eventId,
      eventType: event.eventType,
      requestId: requestId ?? null,
      traceparent: traceparent ?? null,
      tracestate: tracestate ?? null,
      payload: {
        ...event,
        eventId,
        ...(requestId ? { requestId } : {}),
        ...(traceparent ? { traceparent } : {}),
        ...(tracestate ? { tracestate } : {}),
      },
    });
    return eventId;
  }

  private async insertProcessingRun(
    manager: EntityManager,
    run: {
      orderId: number;
      generation: number;
      processingRun: number;
      source: OrderProcessingRunSource;
      eventId: string;
      eventType: string;
      requestedBy?: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(OrderProcessingRunEntity).insert({
      ...run,
      status: 'PENDING',
      failureReason: null,
      startedAt: null,
      completedAt: null,
      requestedBy: run.requestedBy ?? null,
    });
  }

  async findOne(id: number, withItems = false) {
    const entity = await this.repository.findOne({
      where: { id },
      ...(withItems ? { relations: ['items'] } : {}),
    });
    return entity ? toOrder(entity) : null;
  }

  async findAll(skip: number, take: number): Promise<[Order[], number]> {
    const [entities, count] = await this.repository.findAndCount({
      skip,
      take,
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });
    return [entities.map(toOrder), count];
  }

  async reserveAndProcess(
    id: number,
    generation: number,
    processingRun: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(OrderEntity, {
        where: { id },
        relations: ['items'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Pedido ${id} não encontrado`);
      if (
        order.generation !== generation ||
        order.processingRun !== processingRun
      ) {
        return;
      }
      if (order.status === 'PROCESSED' || order.status === 'FAILED') return;

      for (const item of order.items) {
        const result = await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ stock: () => `stock - ${item.quantity}` })
          .where('name = :name AND stock >= :quantity', {
            name: item.productName,
            quantity: item.quantity,
          })
          .execute();
        if (result.affected !== 1) {
          throw new InsufficientStockError(item.productName);
        }
      }
      const completedAt = new Date();
      await manager.update(OrderEntity, id, {
        status: 'PROCESSED',
        failureReason: null,
      });
      const runResult = await manager
        .createQueryBuilder()
        .update(OrderProcessingRunEntity)
        .set({
          status: 'PROCESSED',
          failureReason: null,
          startedAt: () => 'COALESCE(startedAt, CURRENT_TIMESTAMP)',
          completedAt,
        })
        .where(
          'orderId = :id AND generation = :generation AND processingRun = :processingRun AND status = :pending',
          { id, generation, processingRun, pending: 'PENDING' },
        )
        .execute();
      if (runResult.affected !== 1) {
        throw new Error(
          `Tentativa de processamento ${id}/${generation}/${processingRun} não encontrada ou já finalizada`,
        );
      }
    });
  }

  async startProcessingRun(
    id: number,
    generation: number,
    processingRun: number,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(OrderEntity, {
        where: { id },
        ...(this.dataSource.options.type === 'mysql'
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      if (
        !order ||
        order.generation !== generation ||
        order.processingRun !== processingRun ||
        order.status !== 'PENDING'
      ) {
        return false;
      }
      const runs = manager.getRepository(OrderProcessingRunEntity);
      const result = await runs
        .createQueryBuilder()
        .update(OrderProcessingRunEntity)
        .set({ startedAt: () => 'COALESCE(startedAt, CURRENT_TIMESTAMP)' })
        .where(
          'orderId = :id AND generation = :generation AND processingRun = :processingRun AND status = :pending',
          { id, generation, processingRun, pending: 'PENDING' },
        )
        .execute();
      if (result.affected) return true;
      const run = await runs.findOneBy({
        orderId: id,
        generation,
        processingRun,
      });
      if (!run) {
        throw new Error(
          `Tentativa de processamento ${id}/${generation}/${processingRun} não encontrada`,
        );
      }
      return run.status === 'PENDING';
    });
  }

  async updateStatusForGeneration(
    id: number,
    generation: number,
    processingRun: number,
    status: Order['status'],
    failureReason?: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(OrderEntity)
        .set({ status, failureReason: failureReason ?? null })
        .where(
          'id = :id AND generation = :generation AND processingRun = :processingRun AND status = :pending',
          { id, generation, processingRun, pending: 'PENDING' },
        )
        .execute();
      if (result.affected !== 1) return false;
      const runResult = await manager
        .createQueryBuilder()
        .update(OrderProcessingRunEntity)
        .set({
          status,
          failureReason: status === 'FAILED' ? (failureReason ?? null) : null,
          startedAt: () => 'COALESCE(startedAt, CURRENT_TIMESTAMP)',
          completedAt: new Date(),
        })
        .where(
          'orderId = :id AND generation = :generation AND processingRun = :processingRun AND status = :pending',
          { id, generation, processingRun, pending: 'PENDING' },
        )
        .execute();
      if (runResult.affected !== 1) {
        throw new Error(
          `Tentativa de processamento ${id}/${generation}/${processingRun} não encontrada ou já finalizada`,
        );
      }
      return true;
    });
  }
}
