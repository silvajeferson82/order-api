import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/product.entity';
import { OrderQueueModule } from '../queue/order-queue.module';
import { OrderConsumerService } from '../queue/order-consumer.service';
import { ORDER_EVENT_PUBLISHER } from '../application/ports/order-event-publisher.port';
import { ORDER_REPOSITORY } from '../application/ports/order-repository.port';
import { PRODUCT_REPOSITORY } from '../application/ports/product-repository.port';
import { OrderEventPublisherAdapter } from '../infrastructure/queue/order-event-publisher.adapter';
import { TypeOrmOrderRepository } from '../infrastructure/orders/typeorm-order.repository';
import { TypeOrmProductRepository } from '../infrastructure/orders/typeorm-product.repository';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product]),
    OrderQueueModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderConsumerService,
    TypeOrmOrderRepository,
    TypeOrmProductRepository,
    OrderEventPublisherAdapter,
    { provide: ORDER_REPOSITORY, useExisting: TypeOrmOrderRepository },
    { provide: PRODUCT_REPOSITORY, useExisting: TypeOrmProductRepository },
    { provide: ORDER_EVENT_PUBLISHER, useExisting: OrderEventPublisherAdapter },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
