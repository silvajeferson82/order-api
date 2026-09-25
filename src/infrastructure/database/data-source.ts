import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Order } from '../../orders/order.entity';
import { OrderItem } from '../../orders/order-item.entity';
import { Product } from '../../products/product.entity';

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME ?? 'order_db',
  entities: [Order, OrderItem, Product],
  migrations: [__dirname + '/migrations/*{.js,.ts}'],
  synchronize: false,
});
