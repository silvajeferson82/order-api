export class OrderNotFoundError extends Error {
  constructor(readonly orderId: number) {
    super(`Pedido ${orderId} não encontrado`);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderNotReprocessableError extends Error {
  constructor(readonly orderId: number) {
    super(`Pedido ${orderId} não está FAILED`);
    this.name = 'OrderNotReprocessableError';
  }
}
