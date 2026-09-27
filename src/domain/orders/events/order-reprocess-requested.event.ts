import type { DomainEvent } from './domain-event';

export class OrderReprocessRequestedEvent implements DomainEvent {
  readonly eventType = 'order.reprocess.requested';
  readonly version = 1;

  constructor(
    readonly orderId: number,
    readonly generation: number,
    readonly processingRun: number,
    readonly requestId?: string,
  ) {}
}
