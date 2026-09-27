import type { Order } from '../../domain/orders/order';
import { OrderEntity } from '../database/entities/order.entity';
import { OrderItemEntity } from '../database/entities/order-item.entity';
import { toOrder, toOrderEntity } from './order.mapper';

describe('order mapper', () => {
  const order: Order = {
    id: 4,
    customerName: 'Alice',
    total: 25,
    status: 'PENDING',
    generation: 1,
    processingRun: 1,
    failureReason: null,
    items: [{ id: 7, productName: 'Keyboard', quantity: 1, price: 25 }],
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    updatedAt: new Date('2026-09-25T00:00:00.000Z'),
  };

  it('converte o modelo de domínio em entidades TypeORM', () => {
    const entity = toOrderEntity(order);

    expect(entity).toBeInstanceOf(OrderEntity);
    expect(entity.items[0]).toBeInstanceOf(OrderItemEntity);
    expect(entity).toMatchObject({
      id: order.id,
      customerName: order.customerName,
      total: order.total,
      status: order.status,
    });
    expect(entity.items[0]).toMatchObject(order.items[0]);
  });

  it('converte entidades TypeORM para um modelo de domínio simples', () => {
    const entity = toOrderEntity(order);
    const mapped = toOrder(entity);

    expect(mapped).toEqual(order);
    expect(mapped).not.toBeInstanceOf(OrderEntity);
    expect(mapped.items[0]).not.toBeInstanceOf(OrderItemEntity);
  });
});
