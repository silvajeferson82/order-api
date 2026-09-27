import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import * as amqp from 'amqplib';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderEntity } from '../src/infrastructure/database/entities/order.entity';
import { OrderItemEntity } from '../src/infrastructure/database/entities/order-item.entity';
import { ProductEntity } from '../src/infrastructure/database/entities/product.entity';
import { OutboxEventEntity } from '../src/infrastructure/database/entities/outbox-event.entity';
import { OrderProcessingRunEntity } from '../src/infrastructure/database/entities/order-processing-run.entity';
import { OrdersService } from '../src/application/orders.service';
import { OrderQueuePublisher } from '../src/queue/rabbitmq.service';

describe('aceitação real MySQL + RabbitMQ', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let amqpConnection: amqp.ChannelModel;
  let amqpChannel: amqp.ConfirmChannel;

  beforeAll(async () => {
    if (
      process.env.DB_TYPE !== 'mysql' ||
      process.env.RABBITMQ_ENABLED !== 'true' ||
      !process.env.RABBITMQ_URL
    ) {
      throw new Error(
        'Aceitação exige DB_TYPE=mysql e RabbitMQ real habilitado; use npm run test:acceptance:compose.',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    await waitForRabbitPublisher(app);
    amqpConnection = await amqp.connect(process.env.RABBITMQ_URL);
    amqpChannel = await amqpConnection.createConfirmChannel();
  }, 30000);

  afterAll(async () => {
    await amqpChannel?.close();
    await amqpConnection?.close();
    const publisher = app?.get(OrderQueuePublisher);
    await app?.close();
    await publisher?.onModuleDestroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('percorre POST -> MySQL -> RabbitMQ -> consumer -> estado PROCESSED', async () => {
    const response = await request(server)
      .post('/orders')
      .send({
        customerName: 'Aceitação do fluxo',
        items: [
          { productName: 'acceptance-happy-path', quantity: 2, price: 3 },
        ],
      })
      .expect(201);
    const created = response.body as { id: number; status: string };
    expect(created.status).toBe('PENDING');

    const finalOrder = await waitForStatus(server, created.id, 'PROCESSED');
    expect(finalOrder.failureReason).toBeNull();
    const run = await dataSource
      .getRepository(OrderProcessingRunEntity)
      .findOneByOrFail({
        orderId: created.id,
        generation: 1,
        processingRun: 1,
      });
    expect(run).toMatchObject({
      source: 'CREATE',
      eventType: 'order.created',
      status: 'PROCESSED',
      requestedBy: null,
    });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.completedAt).toBeInstanceOf(Date);
    const outbox = await dataSource
      .getRepository(OutboxEventEntity)
      .findOneByOrFail({ eventId: run.eventId });
    expect(outbox.eventType).toBe(run.eventType);
    const stock = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({
        name: 'acceptance-happy-path',
      });
    expect(stock.stock).toBe(3);
  }, 15000);

  it('faz rollback de todos os itens quando o segundo produto não tem estoque', async () => {
    const response = await request(server)
      .post('/orders')
      .send({
        customerName: 'Aceitação de rollback',
        items: [
          { productName: 'rollback-first-item', quantity: 2, price: 1 },
          { productName: 'rollback-insufficient-item', quantity: 6, price: 1 },
        ],
      })
      .expect(201);
    const created = response.body as { id: number };
    const finalOrder = await waitForStatus(server, created.id, 'FAILED');
    expect(finalOrder.failureReason).toContain('Estoque insuficiente');
    const run = await dataSource
      .getRepository(OrderProcessingRunEntity)
      .findOneByOrFail({
        orderId: created.id,
        generation: 1,
        processingRun: 1,
      });
    expect(run).toMatchObject({
      status: 'FAILED',
      failureReason: finalOrder.failureReason,
      eventType: 'order.created',
    });
    expect(run.completedAt).toBeInstanceOf(Date);
    const firstProduct = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ name: 'rollback-first-item' });
    expect(firstProduct.stock).toBe(5);
  }, 15000);

  it('reprocessa pedido FAILED com geração nova e ignora evento antigo', async () => {
    const response = await request(server)
      .post('/orders')
      .send({
        customerName: 'Aceitação de reprocessamento',
        items: [
          { productName: 'acceptance-manual-reprocess', quantity: 6, price: 1 },
        ],
      })
      .expect(201);
    const created = response.body as { id: number };
    const failed = await waitForStatus(server, created.id, 'FAILED');
    expect(failed.failureReason).toContain('Estoque insuficiente');

    const product = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ name: 'acceptance-manual-reprocess' });
    await dataSource
      .getRepository(ProductEntity)
      .update(product.id, { stock: 10 });

    const reprocessResponse = await request(server)
      .post(`/orders/${created.id}/reprocess`)
      .expect(202);
    expect(reprocessResponse.body).toMatchObject({
      status: 'PENDING',
      generation: 2,
      processingRun: 2,
    });
    const processed = await waitForOrder(server, created.id, 'PROCESSED');
    expect(processed.generation).toBe(2);
    const runs = await dataSource
      .getRepository(OrderProcessingRunEntity)
      .findBy({ orderId: created.id });
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: 1,
          processingRun: 1,
          source: 'CREATE',
          status: 'FAILED',
        }),
        expect.objectContaining({
          generation: 2,
          processingRun: 2,
          source: 'MANUAL',
          status: 'PROCESSED',
          requestedBy: null,
        }),
      ]),
    );

    const reprocessEvent = await dataSource
      .getRepository(OutboxEventEntity)
      .findOneByOrFail({ eventType: 'order.reprocess.requested' });
    expect(reprocessEvent.payload).toMatchObject({
      eventType: 'order.reprocess.requested',
      version: 1,
      orderId: created.id,
      generation: 2,
      processingRun: 2,
    });
    const manualRun = runs.find((run) => run.generation === 2);
    expect(manualRun?.eventId).toBe(reprocessEvent.eventId);
    expect(manualRun?.eventType).toBe(reprocessEvent.eventType);

    amqpChannel.sendToQueue(
      'order.created',
      Buffer.from(
        JSON.stringify({
          eventType: 'order.created',
          version: 1,
          orderId: created.id,
          generation: 1,
          processingRun: 1,
        }),
      ),
      { persistent: true },
    );
    await amqpChannel.waitForConfirms();
    await waitUntil(async () => {
      const queue = await amqpChannel.checkQueue('order.created');
      return queue.messageCount === 0;
    });
    await delay(250);
    const finalProduct = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ name: 'acceptance-manual-reprocess' });
    expect(finalProduct.stock).toBe(4);
  }, 20000);

  it('serializa solicitações concorrentes de reprocessamento e grava um evento', async () => {
    const id = await createOrderWithoutOutbox(
      dataSource,
      'acceptance-reprocess-race',
      1,
    );
    await dataSource.getRepository(OrderEntity).update(id, {
      status: 'FAILED',
      failureReason: 'falha anterior',
    });
    await dataSource
      .getRepository(OrderProcessingRunEntity)
      .update(
        { orderId: id, generation: 1, processingRun: 1 },
        { status: 'FAILED', failureReason: 'falha anterior' },
      );

    const responses = await Promise.all([
      request(server).post(`/orders/${id}/reprocess`),
      request(server).post(`/orders/${id}/reprocess`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      202, 409,
    ]);
    const order = await dataSource
      .getRepository(OrderEntity)
      .findOneByOrFail({ id });
    expect(order.status).toBe('PENDING');
    expect(order.generation).toBe(2);
    expect(order.processingRun).toBe(2);

    const reprocessEvents = await dataSource
      .getRepository(OutboxEventEntity)
      .findBy({ eventType: 'order.reprocess.requested' });
    expect(
      reprocessEvents.filter((event) => Number(event.payload.orderId) === id),
    ).toHaveLength(1);
    const history = await dataSource
      .getRepository(OrderProcessingRunEntity)
      .findBy({ orderId: id });
    expect(history).toHaveLength(2);
    expect(history.filter((run) => run.generation === 2)).toHaveLength(1);
  }, 15000);

  it('serializa reservas concorrentes no MySQL sem permitir saldo negativo', async () => {
    const products = dataSource.getRepository(ProductEntity);
    await products.save(products.create({ name: 'acceptance-race', stock: 5 }));
    const firstOrderId = await createOrderWithoutOutbox(
      dataSource,
      'acceptance-race',
      4,
    );
    const secondOrderId = await createOrderWithoutOutbox(
      dataSource,
      'acceptance-race',
      4,
    );
    const ordersService = app.get(OrdersService);
    const outcomes = await Promise.allSettled([
      ordersService.reserveProductsForOrder(firstOrderId),
      ordersService.reserveProductsForOrder(secondOrderId),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    const product = await products.findOneByOrFail({ name: 'acceptance-race' });
    expect(product.stock).toBe(1);
    expect(product.stock).toBeGreaterThanOrEqual(0);
  }, 15000);

  it('não decrementa novamente ao receber a mesma mensagem (reentrega)', async () => {
    const response = await request(server)
      .post('/orders')
      .send({
        customerName: 'Aceitação de reentrega',
        items: [
          { productName: 'acceptance-redelivery', quantity: 2, price: 2 },
        ],
      })
      .expect(201);
    const created = response.body as { id: number };
    await waitForStatus(server, created.id, 'PROCESSED');
    const body = Buffer.from(
      JSON.stringify({
        eventType: 'order.created',
        version: 1,
        orderId: created.id,
        generation: 1,
        processingRun: 1,
      }),
    );
    amqpChannel.sendToQueue('order.created', body, { persistent: true });
    amqpChannel.sendToQueue('order.created', body, { persistent: true });
    await amqpChannel.waitForConfirms();
    await waitUntil(async () => {
      const queue = await amqpChannel.checkQueue('order.created');
      return queue.messageCount === 0;
    });
    await delay(300);
    const product = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ name: 'acceptance-redelivery' });
    expect(product.stock).toBe(3);
    expect(
      await dataSource
        .getRepository(OrderProcessingRunEntity)
        .countBy({ orderId: created.id }),
    ).toBe(1);
  }, 15000);

  it('impõe unicidade por pedido, generation e processingRun no MySQL', async () => {
    const response = await request(server)
      .post('/orders')
      .send({
        customerName: 'Aceitação de constraint',
        items: [
          { productName: 'acceptance-run-unique', quantity: 1, price: 1 },
        ],
      })
      .expect(201);
    const created = response.body as { id: number };
    const runs = dataSource.getRepository(OrderProcessingRunEntity);
    await expect(
      runs.insert({
        orderId: created.id,
        generation: 1,
        processingRun: 1,
        source: 'CREATE',
        eventId: null,
        eventType: 'order.created',
        status: 'PENDING',
        failureReason: null,
        startedAt: null,
        completedAt: null,
        requestedBy: null,
      }),
    ).rejects.toThrow();
  }, 15000);

  it('reprocessa erro MySQL transitório por fila TTL real e conclui o pedido', async () => {
    await dataSource
      .getRepository(ProductEntity)
      .save({ name: 'acceptance-transient-retry', stock: 5 });
    const lockRunner = dataSource.createQueryRunner();
    await lockRunner.connect();
    await lockRunner.startTransaction();
    await lockRunner.query(
      'SELECT id FROM products WHERE name = ? FOR UPDATE',
      ['acceptance-transient-retry'],
    );
    let transientOrderId = 0;
    try {
      const response = await request(server)
        .post('/orders')
        .send({
          customerName: 'Aceitação de retry transitório',
          items: [
            {
              productName: 'acceptance-transient-retry',
              quantity: 1,
              price: 1,
            },
          ],
        })
        .expect(201);
      const created = response.body as { id: number };
      transientOrderId = created.id;

      await waitUntil(async () => {
        const retryQueues = await Promise.all(
          [1, 2, 3].map((number) =>
            amqpChannel.checkQueue(`order.created.retry.${number}`),
          ),
        );
        return retryQueues.some((queue) => queue.messageCount > 0);
      });
    } finally {
      await lockRunner.rollbackTransaction();
      await lockRunner.release();
    }

    await waitForStatus(server, transientOrderId, 'PROCESSED');
    const product = await dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ name: 'acceptance-transient-retry' });
    expect(product.stock).toBe(4);
  }, 20000);

  it('envia evento permanente inválido à DLQ real', async () => {
    await drainQueue('order.created.dlq');
    amqpChannel.sendToQueue('order.created', Buffer.from('{malformed-json'), {
      persistent: true,
    });
    await amqpChannel.waitForConfirms();
    await waitUntil(async () => {
      const queue = await amqpChannel.checkQueue('order.created.dlq');
      return queue.messageCount > 0;
    });
    expect(
      (await amqpChannel.checkQueue('order.created.dlq')).messageCount,
    ).toBe(1);
    await drainQueue('order.created.dlq');
  }, 15000);

  it('aguarda o TTL de retry RabbitMQ antes de retornar à fila e à DLQ', async () => {
    await drainQueue('order.created.dlq');
    const startedAt = Date.now();
    amqpChannel.sendToQueue(
      'order.created.retry.1',
      Buffer.from('{malformed-retry-json'),
      {
        persistent: true,
        headers: { 'x-retry-count': 1 },
      },
    );
    await amqpChannel.waitForConfirms();
    await waitUntil(async () => {
      const queue = await amqpChannel.checkQueue('order.created.dlq');
      return queue.messageCount > 0;
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(800);
    await drainQueue('order.created.dlq');
  }, 15000);

  async function drainQueue(queueName: string): Promise<void> {
    while (true) {
      const message = await amqpChannel.get(queueName, { noAck: false });
      if (message === false) return;
      amqpChannel.ack(message);
    }
  }
});

async function createOrderWithoutOutbox(
  dataSource: DataSource,
  productName: string,
  quantity: number,
): Promise<number> {
  const entity = new OrderEntity();
  entity.customerName = `concurrent-${productName}-${quantity}`;
  entity.total = quantity;
  entity.status = 'PENDING';
  entity.failureReason = null;
  const item = new OrderItemEntity();
  item.productName = productName;
  item.quantity = quantity;
  item.price = 1;
  item.order = entity;
  entity.items = [item];
  const saved = await dataSource.getRepository(OrderEntity).save(entity);
  await dataSource.getRepository(OrderProcessingRunEntity).insert({
    orderId: saved.id,
    generation: saved.generation,
    processingRun: saved.processingRun,
    source: 'CREATE',
    eventId: null,
    eventType: 'order.created',
    status: 'PENDING',
    failureReason: null,
    startedAt: null,
    completedAt: null,
    requestedBy: null,
  });
  return saved.id;
}

async function waitForRabbitPublisher(app: INestApplication): Promise<void> {
  await waitUntil(() => app.get(OrderQueuePublisher).getChannel() !== null);
}

async function waitForStatus(
  server: Server,
  id: number,
  expectedStatus: string,
): Promise<{
  status: string;
  failureReason: string | null;
  generation?: number;
}> {
  let result:
    | { status: string; failureReason: string | null; generation?: number }
    | undefined;
  await waitUntil(async () => {
    const response = await request(server).get(`/orders/${id}`).expect(200);
    result = response.body as {
      status: string;
      failureReason: string | null;
      generation?: number;
    };
    return result.status === expectedStatus;
  });
  return result as { status: string; failureReason: string | null };
}

async function waitForOrder(
  server: Server,
  id: number,
  expectedStatus: string,
): Promise<{ status: string; generation: number }> {
  const result = await waitForStatus(server, id, expectedStatus);
  return result as { status: string; generation: number };
}

async function waitUntil(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timeout aguardando condição');
    await delay(50);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
