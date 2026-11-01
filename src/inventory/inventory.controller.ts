import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { DecrementStockDto } from './dto/decrement-stock.dto';
import {
  InventoryOperationResultDto,
  ProductStockResponseDto,
} from './dto/product-stock-response.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { RestockDto } from './dto/restock.dto';
import { PaginatedStockMovementsResponseDto } from './dto/stock-movement-response.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Public()
  @ApiOperation({ summary: 'Check current product stock and availability' })
  @ApiOkResponse({ type: ProductStockResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @Get('products/:productId/stock')
  async getStock(
    @Param('productId') productId: string,
  ): Promise<ProductStockResponseDto> {
    return this.inventoryService.getStock(productId);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Atomically decrement product stock (e.g. order purchase)',
  })
  @ApiOkResponse({ type: InventoryOperationResultDto })
  @ApiConflictResponse({
    description: 'Insufficient stock or update conflict',
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @HttpCode(HttpStatus.OK)
  @Post('products/:productId/decrement')
  async decrement(
    @Param('productId') productId: string,
    @Body() dto: DecrementStockDto,
    @CurrentUser() user?: AuthUser,
  ): Promise<InventoryOperationResultDto> {
    return this.inventoryService.decrementStock(productId, dto, user?.userId);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Restock product inventory (Admin only)' })
  @ApiOkResponse({ type: InventoryOperationResultDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @HttpCode(HttpStatus.OK)
  @Post('products/:productId/restock')
  async restock(
    @Param('productId') productId: string,
    @Body() dto: RestockDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryOperationResultDto> {
    return this.inventoryService.restock(productId, dto, user.userId);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Adjust product stock count following audit (Admin only)',
  })
  @ApiOkResponse({ type: InventoryOperationResultDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @HttpCode(HttpStatus.OK)
  @Post('products/:productId/adjust')
  async adjust(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryOperationResultDto> {
    return this.inventoryService.adjustStock(productId, dto, user.userId);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Get products below a stock threshold (Admin only)',
  })
  @ApiQuery({ name: 'threshold', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @Get('low-stock')
  async getLowStock(
    @Query('threshold') threshold?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.inventoryService.getLowStock(
      threshold ? Number(threshold) : 10,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Browse complete audit logs of stock movements (Admin only)',
  })
  @ApiOkResponse({ type: PaginatedStockMovementsResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN role' })
  @Get('movements')
  async getMovements(
    @Query() query: QueryStockMovementsDto,
  ): Promise<PaginatedStockMovementsResponseDto> {
    return this.inventoryService.getMovements(query);
  }
}
