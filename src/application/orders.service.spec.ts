import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { Order } from '../domain/orders/order';
import type { OrderRepository } from '../domain/orders/order-repository';
import type { ProductRepository } from '../domain/products/product-repository';
import type { OrderEventPublisher } from './ports/order-event-publisher.port';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: jest.Mocked<OrderRepository>;
  let productRepository: jest.Mocked<ProductRepository>;
  let publisher: jest.Mocked<OrderEventPublisher>;

  const savedOrder: Order = {
    id: 1,
    customerName: 'Alice Silva',
    total: 240,
    status: 'PENDING',
    failureReason: null,
    items: [
      { id: 1, productName: 'Keyboard', quantity: 2, price: 100 },
      { id: 2, productName: 'Mouse', quantity: 1, price: 40 },
    ],
    createdAt: new Date('2026-09-25T14:48:27.530Z'),
    updatedAt: new Date('2026-09-25T14:48:27.530Z'),
  };

  beforeEach(() => {
    orderRepository = {
      create: jest.fn((draft) => draft),
      save: jest.fn().mockResolvedValue(savedOrder),
      findOne: jest.fn(),
      findAll: jest.fn(),
      reserveAndProcess: jest.fn(),
    };
    productRepository = {
      findByName: jest.fn().mockResolvedValue({
        id: 1,
        name: 'Keyboard',
        stock: 5,
        createdAt: new Date(),
      }),
      create: jest.fn(),
      save: jest.fn(),
    };
    publisher = { publishOrderCreated: jest.fn() };
    service = new OrdersService(orderRepository, productRepository, publisher);
  });

  it('calcula o total de vários itens', () => {
    expect(
      service.calculateTotal([
        { productName: 'Keyboard', quantity: 2, price: 100 },
        { productName: 'Mouse', quantity: 1, price: 40 },
      ]),
    ).toBe(240);
  });

  it('cria o pedido e publica o evento após salvar', async () => {
    const result = await service.create({
      customerName: 'Alice Silva',
      items: [
        { productName: 'Keyboard', quantity: 2, price: 100 },
        { productName: 'Mouse', quantity: 1, price: 40 },
      ],
    });

    expect(result).toBe(savedOrder);
    expect(orderRepository.create.mock.calls).toHaveLength(1);
    expect(orderRepository.create.mock.calls[0][0]).toEqual({
      customerName: 'Alice Silva',
      total: 240,
      status: 'PENDING',
      items: [
        { productName: 'Keyboard', quantity: 2, price: 100 },
        { productName: 'Mouse', quantity: 1, price: 40 },
      ],
    });
    expect(publisher.publishOrderCreated.mock.calls).toHaveLength(1);
    expect(publisher.publishOrderCreated.mock.calls[0][0]).toEqual(
      expect.objectContaining({ orderId: 1, total: 240 }),
    );
  });

  it('rejeita paginação fora dos limites', async () => {
    await expect(service.findAll(0, 10)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.findAll(1, 101)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(orderRepository.findAll.mock.calls).toHaveLength(0);
  });
});
