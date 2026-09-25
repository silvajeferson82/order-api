import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../infrastructure/database/entities/order.entity';
import { OrderItemEntity } from '../infrastructure/database/entities/order-item.entity';
import { ProductEntity } from '../infrastructure/database/entities/product.entity';
import { OrderQueueModule } from '../queue/order-queue.module';
import { OrderConsumerService } from '../queue/order-consumer.service';
import { ORDER_EVENT_PUBLISHER } from '../application/ports/order-event-publisher.port';
import { ORDER_REPOSITORY } from '../domain/orders/order-repository';
import { PRODUCT_REPOSITORY } from '../domain/products/product-repository';
import { OrderEventPublisherAdapter } from '../infrastructure/queue/order-event-publisher.adapter';
import { TypeOrmOrderRepository } from '../infrastructure/orders/typeorm-order.repository';
import { TypeOrmProductRepository } from '../infrastructure/orders/typeorm-product.repository';
import { OrdersController } from '../presentation/orders/orders.controller';
import { OrdersService } from '../application/orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderItemEntity, ProductEntity]),
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
