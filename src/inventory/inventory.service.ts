import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { StockMovementType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { DecrementStockDto } from './dto/decrement-stock.dto';
import {
  InventoryOperationResultDto,
  ProductStockResponseDto,
} from './dto/product-stock-response.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { RestockDto } from './dto/restock.dto';
import { PaginatedStockMovementsResponseDto } from './dto/stock-movement-response.dto';

interface UpdatedProductRaw {
  id: string;
  stock: number;
  is_active: boolean;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically decrements product stock.
   * Utilizes PostgreSQL atomic row-level update with `stock >= quantity` check to
   * eliminate race conditions and guarantee `stock >= 0`.
   */
  async decrementStock(
    productId: string,
    dto: DecrementStockDto,
    userId?: string,
  ): Promise<InventoryOperationResultDto> {
    const { quantity, reason, referenceId } = dto;

    return this.prisma.$transaction(async (tx) => {
      // Execute conditional atomic update
      const updatedRows = await tx.$queryRaw<UpdatedProductRaw[]>`
        UPDATE products
        SET stock = stock - ${quantity}, updated_at = NOW()
        WHERE id = ${productId}::uuid AND stock >= ${quantity} AND is_active = true
        RETURNING id, stock, is_active
      `;

      if (updatedRows.length === 0) {
        // Query to provide a precise, actionable HTTP error
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true, name: true, stock: true, isActive: true },
        });

        if (!product) {
          throw new NotFoundException(
            `Product with ID '${productId}' not found`,
          );
        }
        if (!product.isActive) {
          throw new BadRequestException(
            `Cannot decrement stock: product '${product.name}' is inactive`,
          );
        }
        if (product.stock < quantity) {
          throw new ConflictException(
            `Insufficient stock for product '${product.name}'. Available: ${product.stock}, requested: ${quantity}`,
          );
        }

        throw new ConflictException('Inventory update failed due to conflict');
      }

      const updated = updatedRows[0];
      const previousStock = updated.stock + quantity;

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: StockMovementType.OUT,
          quantity,
          balanceAfter: updated.stock,
          reason: reason ?? 'Stock deduction',
          referenceId,
          userId,
        },
      });

      return {
        success: true,
        productId,
        previousStock,
        currentStock: updated.stock,
        movement,
      };
    });
  }

  /**
   * Atomically increments product stock.
   */
  async restock(
    productId: string,
    dto: RestockDto,
    userId?: string,
  ): Promise<InventoryOperationResultDto> {
    const { quantity, reason, referenceId } = dto;

    return this.prisma.$transaction(async (tx) => {
      const updatedRows = await tx.$queryRaw<UpdatedProductRaw[]>`
        UPDATE products
        SET stock = stock + ${quantity}, updated_at = NOW()
        WHERE id = ${productId}::uuid AND is_active = true
        RETURNING id, stock, is_active
      `;

      if (updatedRows.length === 0) {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true, name: true, isActive: true },
        });

        if (!product) {
          throw new NotFoundException(
            `Product with ID '${productId}' not found`,
          );
        }
        if (!product.isActive) {
          throw new BadRequestException(
            `Cannot restock: product '${product.name}' is inactive`,
          );
        }

        throw new ConflictException('Inventory restock failed due to conflict');
      }

      const updated = updatedRows[0];
      const previousStock = updated.stock - quantity;

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: StockMovementType.IN,
          quantity,
          balanceAfter: updated.stock,
          reason: reason ?? 'Restock shipment',
          referenceId,
          userId,
        },
      });

      return {
        success: true,
        productId,
        previousStock,
        currentStock: updated.stock,
        movement,
      };
    });
  }

  /**
   * Manually adjusts stock to a target count (e.g. following physical inventory audit).
   */
  async adjustStock(
    productId: string,
    dto: AdjustStockDto,
    userId?: string,
  ): Promise<InventoryOperationResultDto> {
    const { newStock, reason } = dto;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, stock: true, isActive: true },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID '${productId}' not found`);
      }

      const previousStock = product.stock;
      const delta = Math.abs(newStock - previousStock);

      const updated = await tx.product.update({
        where: { id: productId },
        data: { stock: newStock },
        select: { id: true, stock: true },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: StockMovementType.ADJUSTMENT,
          quantity: delta,
          balanceAfter: newStock,
          reason,
          userId,
        },
      });

      return {
        success: true,
        productId,
        previousStock,
        currentStock: updated.stock,
        movement,
      };
    });
  }

  /**
   * Returns current stock availability of a product.
   */
  async getStock(productId: string): Promise<ProductStockResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${productId}' not found`);
    }

    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      isAvailable: product.isActive && product.stock > 0,
      isActive: product.isActive,
    };
  }

  /**
   * Retrieves products with stock at or below a specified threshold.
   */
  async getLowStock(
    threshold: number = 10,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    items: ProductStockResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const normalizedPage = Math.max(1, page);
    const normalizedLimit = Math.min(100, Math.max(1, limit));
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where: Prisma.ProductWhereInput = {
      stock: { lte: threshold },
      isActive: true,
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: normalizedLimit,
        orderBy: { stock: 'asc' },
        select: {
          id: true,
          name: true,
          sku: true,
          stock: true,
          isActive: true,
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const items: ProductStockResponseDto[] = products.map((p) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      isAvailable: p.isActive && p.stock > 0,
      isActive: p.isActive,
    }));

    return {
      items,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil(total / normalizedLimit) || 1,
    };
  }

  /**
   * Retrieves paginated audit log of stock movements.
   */
  async getMovements(
    query: QueryStockMovementsDto,
  ): Promise<PaginatedStockMovementsResponseDto> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {};
    if (query.productId) {
      where.productId = query.productId;
    }
    if (query.type) {
      where.type = query.type;
    }

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
