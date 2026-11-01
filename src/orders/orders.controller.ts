import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CheckoutDto } from './dto/checkout.dto';
import {
  OrderResponseDto,
  PaginatedOrdersResponseDto,
} from './dto/order-response.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({
    summary:
      'Checkout current cart in one atomic transaction (order, price snapshot, stock decrement, clear cart)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional unique key per checkout attempt to safely deduplicate repeated requests',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({
    description: 'Empty cart, inactive product, or invalid idempotency key',
  })
  @ApiConflictResponse({
    description: 'Insufficient stock for one or more items',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Post('checkout')
  async checkout(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') headerKey?: string,
    @Body() dto?: CheckoutDto,
  ): Promise<OrderResponseDto> {
    const rawKey = headerKey ?? dto?.idempotencyKey;
    if (rawKey !== undefined && rawKey.trim().length > 128) {
      throw new BadRequestException(
        'Idempotency-Key must not exceed 128 characters',
      );
    }

    return this.ordersService.checkout(user.userId, rawKey);
  }

  @ApiOperation({ summary: "List current user's orders with pagination" })
  @ApiOkResponse({ type: PaginatedOrdersResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryOrdersDto,
  ): Promise<PaginatedOrdersResponseDto> {
    return this.ordersService.findAllForUser(user.userId, query);
  }

  @ApiOperation({
    summary: 'Get order details by ID (owner or Admin only)',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiForbiddenResponse({ description: 'Cannot access another user order' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOne(id, user);
  }

  @ApiOperation({
    summary:
      'Cancel a PENDING or PAID order and automatically restock inventory',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({
    description: 'Order is already cancelled, shipped, or completed',
  })
  @ApiForbiddenResponse({ description: 'Cannot cancel another user order' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancelOrder(id, user, dto);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Transition order status (Admin only)',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Invalid status transition' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateStatus(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Expire all unpaid PENDING orders past their TTL and restock inventory (Admin only)',
  })
  @HttpCode(HttpStatus.OK)
  @Post('expire-unpaid')
  async expireUnpaid(): Promise<{
    expiredCount: number;
    expiredOrderIds: string[];
  }> {
    return this.ordersService.expireUnpaidOrders();
  }
}
