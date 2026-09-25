import type { ConsumeMessage, ConfirmChannel } from 'amqplib';
import { InsufficientStockError } from '../domain/products/insufficient-stock.error';
import { OrdersService } from '../application/orders.service';
import { OrderQueuePublisher } from './rabbitmq.service';
import { OrderConsumerService } from './order-consumer.service';

jest.mock('./rabbitmq.service', () => ({
  OrderQueuePublisher: class OrderQueuePublisher {},
}));

describe('OrderConsumerService retry e classificação', () => {
  let orders: jest.Mocked<
    Pick<
      OrdersService,
      'findOne' | 'reserveProductsForOrder' | 'updateOrderStatus'
    >
  >;
  let queue: jest.Mocked<
    Pick<
      OrderQueuePublisher,
      'getChannel' | 'publishRetry' | 'registerConsumer'
    >
  >;
  let channel: ConfirmChannel;
  let ack: jest.Mock;
  let nack: jest.Mock;
  let consumer: OrderConsumerService;
  let callback: ((message: ConsumeMessage | null) => void) | undefined;
  let registrationPromise: Promise<void> | undefined;

  beforeEach(() => {
    orders = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 10,
          status: 'PENDING',
        } as unknown as Awaited<ReturnType<OrdersService['findOne']>>),
      ),
      reserveProductsForOrder: jest.fn(),
      updateOrderStatus: jest.fn(),
    };
    ack = jest.fn((message: ConsumeMessage) => {
      void message;
    });
    nack = jest.fn(
      (message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean) => {
        void message;
        void allUpTo;
        void requeue;
      },
    );
    channel = {
      prefetch: jest.fn((count: number) => {
        void count;
        return Promise.resolve();
      }),
      consume: jest.fn(
        (_queue: string, handler: (message: ConsumeMessage | null) => void) => {
          void _queue;
          callback = handler;
          return Promise.resolve({ consumerTag: 'test' });
        },
      ),
      ack,
      nack,
    } as unknown as ConfirmChannel;
    queue = {
      getChannel: jest.fn().mockReturnValue(channel),
      publishRetry: jest.fn().mockResolvedValue(undefined),
      registerConsumer: jest.fn((register) => {
        registrationPromise = register(channel);
      }),
    };
    consumer = new OrderConsumerService(
      orders as unknown as OrdersService,
      queue as unknown as OrderQueuePublisher,
    );
  });

  it('publica falha transitória na fila de backoff antes de confirmar a original', async () => {
    orders.reserveProductsForOrder.mockRejectedValue(
      new Error('MySQL temporariamente indisponível'),
    );
    consumer.onModuleInit();
    await registrationPromise;
    callback?.(message({ orderId: 10 }));
    await flushPromises();

    expect(queue.publishRetry).toHaveBeenCalledWith(
      'order.created.retry.1',
      expect.any(Buffer),
      { 'x-retry-count': 1 },
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('não repete falha permanente de estoque e direciona a mensagem à DLQ', async () => {
    orders.reserveProductsForOrder.mockRejectedValue(
      new InsufficientStockError('Keyboard'),
    );
    consumer.onModuleInit();
    await registrationPromise;
    callback?.(message({ orderId: 10 }));
    await flushPromises();

    expect(orders.updateOrderStatus).toHaveBeenCalledWith(
      10,
      'FAILED',
      'Estoque insuficiente para Keyboard',
    );
    expect(queue.publishRetry).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('move a falha transitória para DLQ depois das três tentativas com backoff', async () => {
    orders.reserveProductsForOrder.mockRejectedValue(
      new Error('falha transitória final'),
    );
    consumer.onModuleInit();
    await registrationPromise;
    callback?.(message({ orderId: 10 }, { 'x-retry-count': 3 }));
    await flushPromises();

    expect(queue.publishRetry).not.toHaveBeenCalled();
    expect(orders.updateOrderStatus).toHaveBeenCalledWith(
      10,
      'FAILED',
      'falha transitória final',
    );
    expect(nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });
});

function message(
  payload: unknown,
  headers: Record<string, unknown> = {},
): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    fields: {} as ConsumeMessage['fields'],
    properties: { headers } as ConsumeMessage['properties'],
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
