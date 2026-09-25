export class InsufficientStockError extends Error {
  constructor(productName: string) {
    super(`Estoque insuficiente para ${productName}`);
    this.name = 'InsufficientStockError';
  }
}
