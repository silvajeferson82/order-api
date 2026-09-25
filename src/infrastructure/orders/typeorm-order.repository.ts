import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OrderDraft,
  OrderRepository,
} from '../../application/ports/order-repository.port';
import { Order } from '../../orders/order.entity';

export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly repository: Repository<Order>,
  ) {}

  create(order: OrderDraft): Order {
    return this.repository.create(order);
  }

  save(order: Order): Promise<Order> {
    return this.repository.save(order);
  }

  findOne(id: number, withItems = false): Promise<Order | null> {
    return this.repository.findOne({
      where: { id },
      ...(withItems ? { relations: ['items'] } : {}),
    });
  }

  findAll(skip: number, take: number): Promise<[Order[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }
}
