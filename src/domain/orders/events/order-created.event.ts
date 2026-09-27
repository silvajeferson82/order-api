import type { DomainEvent } from './domain-event';

export class OrderCreatedEvent implements DomainEvent {
  readonly eventType = 'order.created';
  readonly version = 1;

  constructor(
    readonly orderId: number,
    readonly generation: number,
    readonly processingRun: number,
    readonly requestId?: string,
  ) {}
}
