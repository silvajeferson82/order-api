export interface DomainEvent {
  readonly eventType: string;
  readonly version: number;
  readonly orderId: number;
  readonly generation: number;
  readonly processingRun: number;
  readonly eventId?: string;
  readonly requestId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}
