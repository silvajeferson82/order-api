import type { Product, ProductDraft } from './product';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export interface ProductRepository {
  findByName(name: string): Promise<Product | null>;
  create(product: ProductDraft): ProductDraft;
  save(product: ProductDraft | Product): Promise<Product>;
}
