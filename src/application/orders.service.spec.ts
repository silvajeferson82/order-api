import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { Order } from '../domain/orders/order';
import type { OrderRepository } from '../domain/orders/order-repository';
import type { ProductRepository } from '../domain/products/product-repository';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: jest.Mocked<OrderRepository>;
  let productRepository: jest.Mocked<ProductRepository>;

  const savedOrder: Order = {
    id: 1,
    customerName: 'Alice Silva',
    total: 240,
    status: 'PENDING',
    generation: 1,
    processingRun: 1,
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
      createWithEvent: jest.fn().mockResolvedValue(savedOrder),
      reprocessFailed: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      reserveAndProcess: jest.fn(),
      startProcessingRun: jest.fn(),
      updateStatusForGeneration: jest.fn(),
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
    service = new OrdersService(orderRepository, productRepository);
  });

  it('calcula o total de vários itens', () => {
    expect(
      service.calculateTotal([
        { productName: 'Keyboard', quantity: 2, price: 100 },
        { productName: 'Mouse', quantity: 1, price: 40 },
      ]),
    ).toBe(240);
  });

  it('cria o pedido pendente com o total calculado', async () => {
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
      generation: 1,
      processingRun: 1,
      items: [
        { productName: 'Keyboard', quantity: 2, price: 100 },
        { productName: 'Mouse', quantity: 1, price: 40 },
      ],
    });
    expect(orderRepository.createWithEvent.mock.calls[0]).toEqual([
      expect.anything(),
      expect.any(Function),
      undefined,
    ]);
    expect(result.status).toBe('PENDING');
  });

  it('solicita reprocessamento pelo repositório transacional', async () => {
    orderRepository.reprocessFailed.mockResolvedValue({
      ...savedOrder,
      status: 'PENDING',
      generation: 2,
      processingRun: 2,
    });

    const result = await service.reprocess(1);

    expect(result.generation).toBe(2);
    expect(orderRepository.reprocessFailed.mock.calls[0]).toEqual([
      1,
      expect.any(Function),
      undefined,
    ]);
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
