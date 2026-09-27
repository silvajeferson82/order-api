import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../infrastructure/database/entities/order.entity';
import { OrderItemEntity } from '../infrastructure/database/entities/order-item.entity';
import { ProductEntity } from '../infrastructure/database/entities/product.entity';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';
import { OrderProcessingRunEntity } from '../infrastructure/database/entities/order-processing-run.entity';
import { OrderQueueModule } from '../queue/order-queue.module';
import { OrderConsumerService } from '../queue/order-consumer.service';
import { ORDER_REPOSITORY } from '../domain/orders/order-repository';
import { PRODUCT_REPOSITORY } from '../domain/products/product-repository';
import { TypeOrmOrderRepository } from '../infrastructure/orders/typeorm-order.repository';
import { TypeOrmProductRepository } from '../infrastructure/orders/typeorm-product.repository';
import { OrdersController } from '../presentation/orders/orders.controller';
import { OrdersService } from '../application/orders.service';
import { OutboxDispatcherService } from '../queue/outbox-dispatcher.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      OutboxEventEntity,
      OrderProcessingRunEntity,
    ]),
    OrderQueueModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderConsumerService,
    OutboxDispatcherService,
    TypeOrmOrderRepository,
    TypeOrmProductRepository,
    { provide: ORDER_REPOSITORY, useExisting: TypeOrmOrderRepository },
    { provide: PRODUCT_REPOSITORY, useExisting: TypeOrmProductRepository },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
