import type {
  Order,
  OrderDraft,
  OrderSaveInput,
} from '../../domain/orders/order';
import { OrderEntity } from '../database/entities/order.entity';
import { OrderItemEntity } from '../database/entities/order-item.entity';

export function toOrderEntity(order: OrderSaveInput): OrderEntity {
  const entity = new OrderEntity();
  if ('id' in order) {
    entity.id = order.id;
    entity.failureReason = order.failureReason;
    entity.createdAt = order.createdAt;
    entity.updatedAt = order.updatedAt;
  } else {
    entity.failureReason = null;
  }
  entity.customerName = order.customerName;
  entity.total = Number(order.total);
  entity.status = order.status;
  entity.items = order.items.map((item) => {
    const itemEntity = new OrderItemEntity();
    if ('id' in item) itemEntity.id = item.id;
    itemEntity.productName = item.productName;
    itemEntity.quantity = item.quantity;
    itemEntity.price = Number(item.price);
    itemEntity.order = entity;
    return itemEntity;
  });
  return entity;
}

export function toOrder(entity: OrderEntity): Order {
  return {
    id: entity.id,
    customerName: entity.customerName,
    total: Number(entity.total),
    status: entity.status,
    failureReason: entity.failureReason ?? null,
    items: (entity.items ?? []).map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      price: Number(item.price),
    })),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toOrderDraft(draft: OrderDraft): OrderDraft {
  return {
    customerName: draft.customerName,
    total: Number(draft.total),
    status: draft.status,
    items: draft.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      price: Number(item.price),
    })),
  };
}
