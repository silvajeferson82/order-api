import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductRepository } from '../../application/ports/product-repository.port';
import { Product } from '../../products/product.entity';

export class TypeOrmProductRepository implements ProductRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  findByName(name: string): Promise<Product | null> {
    return this.repository.findOne({ where: { name } });
  }

  create(product: Partial<Product>): Product {
    return this.repository.create(product);
  }

  save(product: Product): Promise<Product> {
    return this.repository.save(product);
  }
}
