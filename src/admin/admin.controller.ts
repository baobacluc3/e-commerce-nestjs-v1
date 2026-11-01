import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { QueryStockMovementsDto } from '../inventory/dto/query-stock-movements.dto';
import { PaginatedStockMovementsResponseDto } from '../inventory/dto/stock-movement-response.dto';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';
import { AdminService } from './admin.service';
import { AdminAdjustStockDto } from './dto/admin-adjust-stock.dto';
import { AdminMetricsResponseDto } from './dto/admin-metrics-response.dto';
import {
  AdminOrderDetailResponseDto,
  PaginatedAdminOrdersResponseDto,
} from './dto/admin-order-detail-response.dto';
import { AdminQueryOrdersDto } from './dto/admin-query-orders.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({
    summary: 'Dashboard aggregate metrics overview (Admin only)',
  })
  @ApiOkResponse({ type: AdminMetricsResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get('metrics')
  async getMetrics(): Promise<AdminMetricsResponseDto> {
    return this.adminService.getMetrics();
  }

  @ApiOperation({
    summary: 'Cross-user order list with multi-parameter filters (Admin only)',
  })
  @ApiOkResponse({ type: PaginatedAdminOrdersResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get('orders')
  async findAllOrders(
    @Query() query: AdminQueryOrdersDto,
  ): Promise<PaginatedAdminOrdersResponseDto> {
    return this.adminService.findAllOrders(query);
  }

  @ApiOperation({
    summary:
      'Detailed order inspection with items and payment logs (Admin only)',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get('orders/:id')
  async findOrderById(
    @Param('id') id: string,
  ): Promise<AdminOrderDetailResponseDto> {
    return this.adminService.findOrderById(id);
  }

  @ApiOperation({
    summary:
      'Update order status with valid state transitions (restocks on cancel) (Admin only)',
  })
  @ApiOkResponse({ description: 'Order status successfully transitioned' })
  @ApiConflictResponse({ description: 'Invalid state machine transition' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updateOrderStatus(id, dto.status, user);
  }

  @ApiOperation({
    summary:
      'Manual stock count adjustment with mandatory audit reason (Admin only)',
  })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @HttpCode(HttpStatus.OK)
  @Post('inventory/adjust')
  async adjustStock(
    @Body() dto: AdminAdjustStockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.adjustStock(dto, user);
  }

  @ApiOperation({
    summary: 'Retrieve products at or below low-stock threshold (Admin only)',
  })
  @ApiQuery({ name: 'threshold', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get('inventory/low-stock')
  async getLowStock(
    @Query('threshold') threshold?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getLowStock(
      threshold ? Number(threshold) : 10,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @ApiOperation({
    summary: 'Browse global inventory stock movements audit trail (Admin only)',
  })
  @ApiOkResponse({ type: PaginatedStockMovementsResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Get('inventory/movements')
  async getMovements(
    @Query() query: QueryStockMovementsDto,
  ): Promise<PaginatedStockMovementsResponseDto> {
    return this.adminService.getMovements(query);
  }
}
