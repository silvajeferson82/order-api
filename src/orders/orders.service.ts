import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_EVENT_PUBLISHER } from '../application/ports/order-event-publisher.port';
import type { OrderEventPublisher } from '../application/ports/order-event-publisher.port';
import { ORDER_REPOSITORY } from '../application/ports/order-repository.port';
import type { OrderRepository } from '../application/ports/order-repository.port';
import { PRODUCT_REPOSITORY } from '../application/ports/product-repository.port';
import type { ProductRepository } from '../application/ports/product-repository.port';
import { CreateOrderDto, CreateOrderItemDto } from './create-order.dto';
import { Order, OrderStatus } from './order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepository,
    @Inject(ORDER_EVENT_PUBLISHER)
    private readonly orderEventPublisher: OrderEventPublisher,
  ) {}

  calculateTotal(items: CreateOrderItemDto[]): number {
    return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  }

  private async ensureProductsExist(
    items: CreateOrderItemDto[],
  ): Promise<void> {
    for (const item of items) {
      const existingProduct = await this.productRepository.findByName(
        item.productName,
      );

      if (!existingProduct) {
        await this.productRepository.save(
          this.productRepository.create({
            name: item.productName,
            stock: 5,
          }),
        );
      }
    }
  }

  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    await this.ensureProductsExist(createOrderDto.items);

    const total = this.calculateTotal(createOrderDto.items);

    const order = this.orderRepository.create({
      customerName: createOrderDto.customerName,
      total,
      status: 'PENDING',
      items: createOrderDto.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    const savedOrder = await this.orderRepository.save(order);

    this.orderEventPublisher.publishOrderCreated({
      orderId: savedOrder.id,
      customerName: savedOrder.customerName,
      total: savedOrder.total,
      items: savedOrder.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        price: Number(item.price),
      })),
    });

    return savedOrder;
  }

  async findAll(
    page = 1,
    limit = 10,
  ): Promise<{ data: Order[]; total: number; page: number; limit: number }> {
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
    const order = await this.orderRepository.findOne(orderId);

    if (!order) {
      throw new NotFoundException(`Pedido ${orderId} não encontrado`);
    }

    order.status = status;
    order.failureReason = failureReason ?? null;

    return this.orderRepository.save(order);
  }

  async reserveProductsForOrder(orderId: number): Promise<void> {
    const order = await this.orderRepository.findOne(orderId, true);

    if (!order) {
      throw new NotFoundException(`Pedido ${orderId} não encontrado`);
    }

    for (const item of order.items) {
      const product = await this.productRepository.findByName(item.productName);

      if (!product) {
        throw new Error(`Produto ${item.productName} não encontrado`);
      }

      if (product.stock < item.quantity) {
        throw new Error('estoque insuficiente');
      }

      product.stock -= item.quantity;
      await this.productRepository.save(product);
    }
  }
}
