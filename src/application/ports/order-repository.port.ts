import { Order } from '../../orders/order.entity';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export type OrderDraft = {
  customerName: string;
  total: number;
  status: Order['status'];
  items: Array<{ productName: string; quantity: number; price: number }>;
};

export interface OrderRepository {
  create(order: OrderDraft): Order;
  save(order: Order): Promise<Order>;
  findOne(id: number, withItems?: boolean): Promise<Order | null>;
  findAll(skip: number, take: number): Promise<[Order[], number]>;
}
