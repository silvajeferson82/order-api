export interface DomainEvent {
  readonly eventType: string;
  readonly version: number;
  readonly orderId: number;
  readonly generation: number;
  readonly processingRun: number;
}
