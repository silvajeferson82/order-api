export type OrderCreatedEvent = {
  orderId: number;
  customerName: string;
  total: number;
  items: Array<{ productName: string; quantity: number; price: number }>;
};

export const ORDER_EVENT_PUBLISHER = Symbol('ORDER_EVENT_PUBLISHER');

export interface OrderEventPublisher {
  publishOrderCreated(event: OrderCreatedEvent): void;
}
