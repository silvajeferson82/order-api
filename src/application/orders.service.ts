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
import { OrderCreatedEvent } from '../domain/orders/events/order-created.event';
import { OrderReprocessRequestedEvent } from '../domain/orders/events/order-reprocess-requested.event';

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

  async create(
    command: CreateOrderCommand,
    requestedBy?: string | null,
  ): Promise<Order> {
    await this.ensureProductsExist(command.items);
    const order = this.orderRepository.create({
      customerName: command.customerName,
      total: this.calculateTotal(command.items),
      status: 'PENDING',
      generation: 1,
      processingRun: 1,
      items: command.items.map((item) => ({ ...item })),
    });
    return this.orderRepository.createWithEvent(
      order,
      (savedOrder) =>
        new OrderCreatedEvent(
          savedOrder.id,
          savedOrder.generation,
          savedOrder.processingRun,
        ),
      requestedBy,
    );
  }

  async reprocess(id: number, requestedBy?: string | null): Promise<Order> {
    return this.orderRepository.reprocessFailed(
      id,
      (savedOrder) =>
        new OrderReprocessRequestedEvent(
          savedOrder.id,
          savedOrder.generation,
          savedOrder.processingRun,
        ),
      requestedBy,
    );
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

  async reserveProductsForOrder(orderId: number): Promise<void> {
    const order = await this.findOne(orderId);
    await this.orderRepository.reserveAndProcess(
      orderId,
      order.generation,
      order.processingRun,
    );
  }

  async reserveGeneration(
    orderId: number,
    generation: number,
    processingRun: number,
  ): Promise<void> {
    await this.orderRepository.reserveAndProcess(
      orderId,
      generation,
      processingRun,
    );
  }

  async startProcessingRun(
    orderId: number,
    generation: number,
    processingRun: number,
  ): Promise<boolean> {
    return this.orderRepository.startProcessingRun(
      orderId,
      generation,
      processingRun,
    );
  }

  async updateOrderStatusForGeneration(
    orderId: number,
    generation: number,
    processingRun: number,
    status: OrderStatus,
    failureReason?: string,
  ): Promise<boolean> {
    return this.orderRepository.updateStatusForGeneration(
      orderId,
      generation,
      processingRun,
      status,
      failureReason,
    );
  }
}
