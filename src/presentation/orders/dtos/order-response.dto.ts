import { ApiProperty } from '@nestjs/swagger';
import type { OrderStatus } from '../../../domain/orders/order';

export class OrderItemResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Keyboard' })
  productName: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 100 })
  price: number;
}

export class OrderResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Alice Silva' })
  customerName: string;

  @ApiProperty({ example: 200 })
  total: number;

  @ApiProperty({ enum: ['PENDING', 'PROCESSED', 'FAILED'], example: 'PENDING' })
  status: OrderStatus;

  @ApiProperty({ example: 1 })
  generation: number;

  @ApiProperty({ example: 1 })
  processingRun: number;

  @ApiProperty({ nullable: true, example: null })
  failureReason: string | null;

  @ApiProperty({ type: () => [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ example: '2026-09-25T14:48:27.530Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-25T14:48:27.530Z' })
  updatedAt: Date;
}

export class OrderListResponseDto {
  @ApiProperty({ type: () => [OrderResponseDto] })
  data: OrderResponseDto[];

  @ApiProperty({ example: 25 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;
}
