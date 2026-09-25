export type CreateOrderCommand = {
  customerName: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
};
