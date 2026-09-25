export type Product = {
  id: number;
  name: string;
  stock: number;
  createdAt: Date;
};

export type ProductDraft = Pick<Product, 'name' | 'stock'>;
