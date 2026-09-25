import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { Order, OrderDraft } from '../../domain/orders/order';
import type { OrderRepository } from '../../domain/orders/order-repository';
import { OrderEntity } from '../database/entities/order.entity';
import { ProductEntity } from '../database/entities/product.entity';
import type { OrderSaveInput } from '../../domain/orders/order';
import { toOrder, toOrderEntity, toOrderDraft } from './order.mapper';

export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly repository: Repository<OrderEntity>,
    private readonly dataSource: DataSource,
  ) {}

  create(order: OrderDraft): OrderDraft {
    return toOrderDraft(order);
  }

  async save(order: OrderSaveInput) {
    const saved = await this.repository.save(toOrderEntity(order));
    return toOrder(saved);
  }

  async findOne(id: number, withItems = false) {
    const entity = await this.repository.findOne({
      where: { id },
      ...(withItems ? { relations: ['items'] } : {}),
    });
    return entity ? toOrder(entity) : null;
  }

  async findAll(skip: number, take: number): Promise<[Order[], number]> {
    const [entities, count] = await this.repository.findAndCount({
      skip,
      take,
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });
    return [entities.map(toOrder), count];
  }

  async reserveAndProcess(id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(OrderEntity, {
        where: { id },
        relations: ['items'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new Error(`Pedido ${id} não encontrado`);
      if (order.status === 'PROCESSED') return;

      for (const item of order.items) {
        const result = await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ stock: () => `stock - ${item.quantity}` })
          .where('name = :name AND stock >= :quantity', {
            name: item.productName,
            quantity: item.quantity,
          })
          .execute();
        if (result.affected !== 1) {
          throw new Error(`Estoque insuficiente para ${item.productName}`);
        }
      }
      await manager.update(OrderEntity, id, {
        status: 'PROCESSED',
        failureReason: null,
      });
    });
  }
}
