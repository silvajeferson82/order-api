import type { Product } from '../../domain/products/product';
import { ProductEntity } from '../database/entities/product.entity';
import { toProduct, toProductEntity } from './product.mapper';

describe('product mapper', () => {
  const product: Product = {
    id: 3,
    name: 'Keyboard',
    stock: 5,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
  };

  it('converte o modelo de domínio em entidade TypeORM', () => {
    const entity = toProductEntity(product);

    expect(entity).toBeInstanceOf(ProductEntity);
    expect(entity).toMatchObject(product);
  });

  it('converte a entidade TypeORM para um modelo de domínio simples', () => {
    const mapped = toProduct(toProductEntity(product));

    expect(mapped).toEqual(product);
    expect(mapped).not.toBeInstanceOf(ProductEntity);
  });
});
