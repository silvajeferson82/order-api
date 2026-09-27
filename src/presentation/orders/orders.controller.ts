import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
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
import {
  OrderNotFoundError,
  OrderNotReprocessableError,
} from '../../domain/orders/order-errors';

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
      'Persiste o pedido como PENDING e grava order.created na outbox transacional para publicação assíncrona.',
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
            generation: 1,
            processingRun: 1,
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
  async create(
    @Body() dto: CreateOrderDto,
    @Req() request: Request & { user?: { sub?: unknown } },
  ): Promise<OrderResponseDto> {
    return this.toResponse(
      await this.ordersService.create(dto, requesterSub(request)),
    );
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('order-admin')
  @ApiOperation({
    summary: 'Reprocessa um pedido FAILED',
    description:
      'Cria uma nova geração de processamento e grava o evento na outbox na mesma transação.',
  })
  @ApiParam({ name: 'id', example: 1, type: Number })
  @ApiResponse({
    status: 202,
    description: 'Nova tentativa aceita; processamento assíncrono iniciado.',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Identificador inválido.' })
  @ApiResponse({ status: 404, description: 'Pedido não encontrado.' })
  @ApiResponse({ status: 409, description: 'Pedido não está FAILED.' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido.' })
  @ApiResponse({ status: 403, description: 'Papel order-admin necessário.' })
  async reprocess(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request & { user?: { sub?: unknown } },
  ): Promise<OrderResponseDto> {
    try {
      return this.toResponse(
        await this.ordersService.reprocess(id, requesterSub(request)),
      );
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof OrderNotReprocessableError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
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
            generation: 1,
            processingRun: 1,
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
                generation: 1,
                processingRun: 1,
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

function requesterSub(
  request: Request & { user?: { sub?: unknown } },
): string | null {
  return typeof request.user?.sub === 'string' && request.user.sub.length > 0
    ? request.user.sub
    : null;
}
