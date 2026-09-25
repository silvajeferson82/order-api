import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ORDER_REPOSITORY } from '../domain/orders/order-repository';
import type { OrderRepository } from '../domain/orders/order-repository';
import { PRODUCT_REPOSITORY } from '../domain/products/product-repository';
import type { ProductRepository } from '../domain/products/product-repository';
import type { Order, OrderStatus } from '../domain/orders/order';
import type { CreateOrderCommand } from './orders/create-order.command';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepository,
  ) {}

  calculateTotal(items: CreateOrderCommand['items']): number {
    return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  }

  private async ensureProductsExist(
    items: CreateOrderCommand['items'],
  ): Promise<void> {
    for (const item of items) {
      const existingProduct = await this.productRepository.findByName(
        item.productName,
      );

      if (!existingProduct) {
        await this.productRepository.save(
          this.productRepository.create({ name: item.productName, stock: 5 }),
        );
      }
    }
  }

  async create(command: CreateOrderCommand): Promise<Order> {
    await this.ensureProductsExist(command.items);
    const order = this.orderRepository.create({
      customerName: command.customerName,
      total: this.calculateTotal(command.items),
      status: 'PENDING',
      items: command.items.map((item) => ({ ...item })),
    });
    const savedOrder = await this.orderRepository.save(order);

    return savedOrder;
  }

  async findAll(
    page = 1,
    limit = 10,
  ): Promise<{ data: Order[]; total: number; page: number; limit: number }> {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException('Paginação inválida');
    }
    const [data, total] = await this.orderRepository.findAll(
      (page - 1) * limit,
      limit,
    );
    return { data, total, page, limit };
  }

  async findOne(id: number): Promise<Order> {
    const order = await this.orderRepository.findOne(id, true);
    if (!order) {
      throw new NotFoundException(`Pedido ${id} não encontrado`);
    }
    return order;
  }

  async updateOrderStatus(
    orderId: number,
    status: OrderStatus,
    failureReason?: string,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne(orderId, true);
    if (!order) {
      throw new NotFoundException(`Pedido ${orderId} não encontrado`);
    }
    order.status = status;
    order.failureReason = failureReason ?? null;
    return this.orderRepository.save(order);
  }

  async reserveProductsForOrder(orderId: number): Promise<void> {
    await this.orderRepository.reserveAndProcess(orderId);
  }
}
