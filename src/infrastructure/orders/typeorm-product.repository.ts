import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ProductRepository } from '../../domain/products/product-repository';
import { ProductEntity } from '../database/entities/product.entity';
import type { Product } from '../../domain/products/product';
import type { ProductDraft } from '../../domain/products/product';
import { toProduct, toProductDraft, toProductEntity } from './product.mapper';

export class TypeOrmProductRepository implements ProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  async findByName(name: string): Promise<Product | null> {
    const entity = await this.repository.findOne({ where: { name } });
    return entity ? toProduct(entity) : null;
  }

  create(product: ProductDraft): ProductDraft {
    return toProductDraft(product);
  }

  async save(product: ProductDraft | Product): Promise<Product> {
    const saved = await this.repository.save(toProductEntity(product));
    return toProduct(saved);
  }
}
