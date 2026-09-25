import { Module } from '@nestjs/common';
import { OrderQueuePublisher } from './rabbitmq.service';

@Module({
  providers: [OrderQueuePublisher],
  exports: [OrderQueuePublisher],
})
export class OrderQueueModule {}
