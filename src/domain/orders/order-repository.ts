import type { Order, OrderDraft, OrderSaveInput } from './order';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface OrderRepository {
  create(order: OrderDraft): OrderDraft;
  save(order: OrderSaveInput): Promise<Order>;
  findOne(id: number, withItems?: boolean): Promise<Order | null>;
  findAll(skip: number, take: number): Promise<[Order[], number]>;
  reserveAndProcess(id: number): Promise<void>;
}
