import type { Repository } from 'typeorm';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';
import { OrderQueuePublisher } from './rabbitmq.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

jest.mock('./rabbitmq.service', () => ({
  OrderQueuePublisher: class OrderQueuePublisher {},
}));
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('OutboxDispatcherService', () => {
  const event: OutboxEventEntity = {
    id: 7,
    eventId: 'event-7',
    eventType: 'order.created',
    payload: { orderId: 7 },
    attempts: 0,
    publishedAt: null,
    createdAt: new Date(),
  };
  let outbox: jest.Mocked<
    Pick<Repository<OutboxEventEntity>, 'find' | 'update' | 'increment'>
  >;
  let publisher: jest.Mocked<
    Pick<OrderQueuePublisher, 'getChannel' | 'publishOrderCreated'>
  >;
  let dispatcher: OutboxDispatcherService;

  beforeEach(() => {
    outbox = {
      find: jest.fn().mockResolvedValue([event]),
      update: jest.fn().mockResolvedValue({ affected: 1, raw: {} }),
      increment: jest.fn().mockResolvedValue({ affected: 1, raw: {} }),
    };
    publisher = {
      getChannel: jest.fn().mockReturnValue({}),
      publishOrderCreated: jest.fn().mockResolvedValue(undefined),
    };
    dispatcher = new OutboxDispatcherService(
      outbox as unknown as Repository<OutboxEventEntity>,
      publisher as unknown as OrderQueuePublisher,
    );
  });

  it('só marca o evento como publicado após publisher confirm', async () => {
    await dispatcher.dispatchPending();

    expect(publisher.publishOrderCreated).toHaveBeenCalledWith({
      orderId: 7,
    });
    expect(outbox.update).toHaveBeenCalledTimes(1);
    expect(outbox.increment).not.toHaveBeenCalled();
  });

  it('preserva evento pendente e registra tentativa se publicação falhar', async () => {
    publisher.publishOrderCreated.mockRejectedValue(
      new Error('broker indisponível'),
    );
    await dispatcher.dispatchPending();

    expect(outbox.update).not.toHaveBeenCalled();
    expect(outbox.increment).toHaveBeenCalledWith({ id: 7 }, 'attempts', 1);
  });
});
