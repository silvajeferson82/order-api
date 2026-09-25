import { Injectable } from '@nestjs/common';
import {
  OrderCreatedEvent,
  OrderEventPublisher,
} from '../../application/ports/order-event-publisher.port';
import { OrderQueuePublisher } from '../../queue/rabbitmq.service';

@Injectable()
export class OrderEventPublisherAdapter implements OrderEventPublisher {
  constructor(private readonly publisher: OrderQueuePublisher) {}

  publishOrderCreated(event: OrderCreatedEvent): Promise<void> {
    return this.publisher.publishOrderCreated(event);
  }
}
