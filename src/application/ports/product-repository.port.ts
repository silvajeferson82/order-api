import { Product } from '../../products/product.entity';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export interface ProductRepository {
  findByName(name: string): Promise<Product | null>;
  create(product: Partial<Product>): Product;
  save(product: Product): Promise<Product>;
}
