jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
  TypeOrmModule: {
    forRoot: () => ({ module: class TestTypeOrmModule {} }),
    forFeature: () => ({ module: class TestTypeOrmFeatureModule {} }),
  },
}));

jest.mock('../queue/rabbitmq.service', () => ({
  OrderQueuePublisher: class TestQueuePublisher {
    publishOrderCreated() {
      return undefined;
    }
  },
}));

import { Repository } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { Product } from '../products/product.entity';

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(() => {
    service = new OrdersService(
      undefined as unknown as Repository<Order>,
      undefined as unknown as Repository<OrderItem>,
      undefined as unknown as Repository<Product>,
      { publishOrderCreated: jest.fn() },
    );
  });

  it('should calculate total for a single item', () => {
    const total = service.calculateTotal([
      { productName: 'Keyboard', quantity: 2, price: 100 },
    ]);

    expect(total).toBe(200);
  });

  it('should calculate total for multiple items', () => {
    const total = service.calculateTotal([
      { productName: 'Keyboard', quantity: 2, price: 100 },
      { productName: 'Mouse', quantity: 1, price: 40 },
    ]);

    expect(total).toBe(240);
  });
});
