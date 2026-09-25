import type { Product, ProductDraft } from '../../domain/products/product';
import { ProductEntity } from '../database/entities/product.entity';

export function toProductEntity(
  product: Product | ProductDraft,
): ProductEntity {
  const entity = new ProductEntity();
  if ('id' in product) {
    entity.id = product.id;
    entity.createdAt = product.createdAt;
  }
  entity.name = product.name;
  entity.stock = product.stock;
  return entity;
}

export function toProduct(entity: ProductEntity): Product {
  return {
    id: entity.id,
    name: entity.name,
    stock: Number(entity.stock),
    createdAt: entity.createdAt,
  };
}

export function toProductDraft(product: ProductDraft): ProductDraft {
  return { name: product.name, stock: Number(product.stock) };
}
