import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, Role } from '../generated/prisma/enums';
import { InventoryService } from '../inventory/inventory.service';
import { QueryStockMovementsDto } from '../inventory/dto/query-stock-movements.dto';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAdjustStockDto } from './dto/admin-adjust-stock.dto';
import {
  AdminMetricsResponseDto,
  AdminOrdersByStatusDto,
} from './dto/admin-metrics-response.dto';
import {
  AdminOrderDetailResponseDto,
  PaginatedAdminOrdersResponseDto,
} from './dto/admin-order-detail-response.dto';
import { AdminQueryOrdersDto } from './dto/admin-query-orders.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * Retrieves cross-user orders with multi-parameter filtering and pagination.
   */
  async findAllOrders(
    query: AdminQueryOrdersDto,
  ): Promise<PaginatedAdminOrdersResponseDto> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.totalPrice = {};
      if (query.minPrice !== undefined) {
        where.totalPrice.gte = query.minPrice;
      }
      if (query.maxPrice !== undefined) {
        where.totalPrice.lte = query.maxPrice;
      }
    }

    if (query.fromDate || query.toDate) {
      where.createdAt = {};
      if (query.fromDate) {
        where.createdAt.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.createdAt.lte = new Date(query.toDate);
      }
    }

    const orderBy: Prisma.OrderOrderByWithRelationInput = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          items: {
            select: { id: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const items = orders.map((o) => ({
      id: o.id,
      user: o.user,
      status: o.status,
      totalPrice: o.totalPrice,
      idempotencyKey: o.idempotencyKey,
      itemCount: o.items.length,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      cancelledAt: o.cancelledAt,
      createdAt: o.createdAt,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves full details of a specific order including user, frozen items, and payment logs.
   */
  async findOrderById(orderId: string): Promise<AdminOrderDetailResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID '${orderId}' not found`);
    }

    return order;
  }

  /**
   * Enforces valid status transitions on an order.
   * If transitioning to CANCELLED, automatically restocks inventory.
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    actor: AuthUser,
  ) {
    return this.ordersService.updateStatus(orderId, { status }, actor);
  }

  /**
   * Adjusts stock quantity following a cycle count or physical audit.
   */
  async adjustStock(dto: AdminAdjustStockDto, actor: AuthUser) {
    return this.inventoryService.adjustStock(
      dto.productId,
      { newStock: dto.newStock, reason: dto.reason },
      actor.userId,
    );
  }

  /**
   * Retrieves products at or below the low-stock threshold.
   */
  async getLowStock(
    threshold: number = 10,
    page: number = 1,
    limit: number = 20,
  ) {
    return this.inventoryService.getLowStock(threshold, page, limit);
  }

  /**
   * Retrieves global stock movements audit trail.
   */
  async getMovements(query: QueryStockMovementsDto) {
    return this.inventoryService.getMovements(query);
  }

  /**
   * Computes aggregate business metrics for the admin dashboard.
   */
  async getMetrics(): Promise<AdminMetricsResponseDto> {
    const revenueStatuses = [
      OrderStatus.PAID,
      OrderStatus.SHIPPED,
      OrderStatus.COMPLETED,
    ];

    const [
      revenueAggregate,
      totalOrders,
      ordersGrouped,
      totalCustomers,
      totalActiveProducts,
      lowStockProductCount,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { totalPrice: true },
        where: { status: { in: revenueStatuses } },
      }),
      this.prisma.order.count(),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.user.count({ where: { role: Role.CUSTOMER } }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.product.count({
        where: { isActive: true, stock: { lte: 10 } },
      }),
    ]);

    const ordersByStatus: AdminOrdersByStatusDto = {
      PENDING: 0,
      PAID: 0,
      SHIPPED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };

    for (const group of ordersGrouped) {
      ordersByStatus[group.status] = group._count.id;
    }

    return {
      grossRevenueCents: revenueAggregate._sum.totalPrice ?? 0,
      totalOrders,
      ordersByStatus,
      totalCustomers,
      totalActiveProducts,
      lowStockProductCount,
    };
  }
}
