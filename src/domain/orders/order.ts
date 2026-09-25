export type OrderStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

export type OrderItem = {
  id: number;
  productName: string;
  quantity: number;
  price: number;
};

export type Order = {
  id: number;
  customerName: string;
  total: number;
  status: OrderStatus;
  failureReason: string | null;
  items: OrderItem[];
  createdAt: Date;
  updatedAt: Date;
};

export type OrderDraft = {
  customerName: string;
  total: number;
  status: OrderStatus;
  items: Array<{ productName: string; quantity: number; price: number }>;
};

export type OrderSaveInput = OrderDraft | Order;
