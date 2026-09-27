import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OrdersService } from '../../application/orders.service';
import { CreateOrderDto } from './dtos/create-order.dto';
import {
  OrderListResponseDto,
  OrderResponseDto,
} from './dtos/order-response.dto';
import { OrderPaginationDto } from './dtos/order-pagination.dto';

@ApiExtraModels(OrderResponseDto, OrderListResponseDto)
@ApiTags('Pedidos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles('order-admin')
  @ApiOperation({
    summary: 'Cria um pedido',
    description:
      'Persiste o pedido com status PENDING e publica o evento order.created.',
  })
  @ApiBody({
    type: CreateOrderDto,
    examples: {
      pedido: {
        summary: 'Pedido com dois itens',
        value: {
          customerName: 'Alice Silva',
          items: [
            { productName: 'Keyboard', quantity: 2, price: 100 },
            { productName: 'Mouse', quantity: 1, price: 40 },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Pedido criado; o processamento ocorre de forma assíncrona.',
    content: {
      'application/json': {
        schema: {
          allOf: [{ $ref: '#/components/schemas/OrderResponseDto' }],
          example: {
            id: 1,
            customerName: 'Alice Silva',
            total: 240,
            status: 'PENDING',
            failureReason: null,
            items: [
              { id: 1, productName: 'Keyboard', quantity: 2, price: 100 },
              { id: 2, productName: 'Mouse', quantity: 1, price: 40 },
            ],
            createdAt: '2026-09-25T14:48:27.530Z',
            updatedAt: '2026-09-25T14:48:27.530Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Dados de entrada inválidos.' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido.' })
  @ApiResponse({ status: 403, description: 'Papel order-admin necessário.' })
  async create(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.toResponse(await this.ordersService.create(dto));
  }

  @Get(':id')
  @Roles('order-user')
  @ApiOperation({ summary: 'Busca um pedido por ID' })
  @ApiParam({ name: 'id', example: 1, type: Number })
  @ApiResponse({
    status: 200,
    content: {
      'application/json': {
        schema: {
          allOf: [{ $ref: '#/components/schemas/OrderResponseDto' }],
          example: {
            id: 1,
            customerName: 'Alice Silva',
            total: 240,
            status: 'PROCESSED',
            failureReason: null,
            items: [
              { id: 1, productName: 'Keyboard', quantity: 2, price: 100 },
              { id: 2, productName: 'Mouse', quantity: 1, price: 40 },
            ],
            createdAt: '2026-09-25T14:48:27.530Z',
            updatedAt: '2026-09-25T14:49:02.120Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pedido não encontrado.' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido.' })
  @ApiResponse({ status: 403, description: 'Papel order-user necessário.' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderResponseDto> {
    return this.toResponse(await this.ordersService.findOne(id));
  }

  @Get()
  @Roles('order-user')
  @ApiOperation({ summary: 'Lista pedidos com paginação' })
  @ApiResponse({
    status: 200,
    content: {
      'application/json': {
        schema: {
          allOf: [{ $ref: '#/components/schemas/OrderListResponseDto' }],
          example: {
            data: [
              {
                id: 1,
                customerName: 'Alice Silva',
                total: 240,
                status: 'PENDING',
                failureReason: null,
                items: [
                  { id: 1, productName: 'Keyboard', quantity: 2, price: 100 },
                ],
                createdAt: '2026-09-25T14:48:27.530Z',
                updatedAt: '2026-09-25T14:48:27.530Z',
              },
            ],
            total: 1,
            page: 1,
            limit: 10,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido.' })
  @ApiResponse({ status: 403, description: 'Papel order-user necessário.' })
  async findAll(
    @Query() pagination: OrderPaginationDto,
  ): Promise<OrderListResponseDto> {
    const result = await this.ordersService.findAll(
      pagination.page,
      pagination.limit,
    );
    return {
      ...result,
      data: result.data.map((order) => this.toResponse(order)),
    };
  }

  private toResponse(
    order: Awaited<ReturnType<OrdersService['findOne']>>,
  ): OrderResponseDto {
    return {
      ...order,
      total: Number(order.total),
      items: order.items.map((item) => ({
        ...item,
        price: Number(item.price),
      })),
    };
  }
}
