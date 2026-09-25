import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsInt,
  ArrayMinSize,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'Keyboard', description: 'Nome do produto' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsNumber()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 100, minimum: 0, description: 'Preço unitário' })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'Alice Silva' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({
    type: () => [CreateOrderItemDto],
    example: [{ productName: 'Keyboard', quantity: 2, price: 100 }],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
