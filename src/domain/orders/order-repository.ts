import type { Order, OrderDraft } from './order';
import type { DomainEvent } from './events/domain-event';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface OrderRepository {
  create(order: OrderDraft): OrderDraft;
  createWithEvent(
    order: OrderDraft,
    eventFor: (savedOrder: Order) => DomainEvent,
    requestedBy?: string | null,
  ): Promise<Order>;
  reprocessFailed(
    id: number,
    eventFor: (savedOrder: Order) => DomainEvent,
    requestedBy?: string | null,
  ): Promise<Order>;
  findOne(id: number, withItems?: boolean): Promise<Order | null>;
  findAll(skip: number, take: number): Promise<[Order[], number]>;
  reserveAndProcess(
    id: number,
    generation: number,
    processingRun: number,
  ): Promise<void>;
  startProcessingRun(
    id: number,
    generation: number,
    processingRun: number,
  ): Promise<boolean>;
  updateStatusForGeneration(
    id: number,
    generation: number,
    processingRun: number,
    status: Order['status'],
    failureReason?: string,
  ): Promise<boolean>;
}
