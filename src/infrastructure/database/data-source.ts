import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { ProductEntity } from './entities/product.entity';
import { OutboxEventEntity } from './entities/outbox-event.entity';

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME ?? 'order_db',
  entities: [OrderEntity, OrderItemEntity, ProductEntity, OutboxEventEntity],
  migrations: [__dirname + '/migrations/*{.js,.ts}'],
  synchronize: false,
});
