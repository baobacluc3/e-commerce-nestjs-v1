import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, Role } from '../generated/prisma/enums';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    order: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
    };
    user: {
      count: jest.Mock;
    };
    product: {
      count: jest.Mock;
    };
  };
  let ordersService: {
    updateStatus: jest.Mock;
  };
  let inventoryService: {
    adjustStock: jest.Mock;
    getLowStock: jest.Mock;
    getMovements: jest.Mock;
  };

  const adminActor = { userId: 'admin-1', role: Role.ADMIN };

  beforeEach(async () => {
    prisma = {
      order: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
      user: {
        count: jest.fn(),
      },
      product: {
        count: jest.fn(),
      },
    };

    ordersService = {
      updateStatus: jest.fn(),
    };

    inventoryService = {
      adjustStock: jest.fn(),
      getLowStock: jest.fn(),
      getMovements: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: OrdersService,
          useValue: ordersService,
        },
        {
          provide: InventoryService,
          useValue: inventoryService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('getMetrics', () => {
    it('aggregates gross revenue, orders by status, and inventory counts', async () => {
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalPrice: 154990 }, // $1,549.90
      });
      prisma.order.count.mockResolvedValue(12);
      prisma.order.groupBy.mockResolvedValue([
        { status: OrderStatus.PAID, _count: { id: 7 } },
        { status: OrderStatus.SHIPPED, _count: { id: 3 } },
        { status: OrderStatus.COMPLETED, _count: { id: 1 } },
        { status: OrderStatus.PENDING, _count: { id: 1 } },
      ]);
      prisma.user.count.mockResolvedValue(45);
      prisma.product.count
        .mockResolvedValueOnce(28) // totalActiveProducts
        .mockResolvedValueOnce(3); // lowStockProductCount

      const metrics = await service.getMetrics();

      expect(metrics.grossRevenueCents).toBe(154990);
      expect(metrics.totalOrders).toBe(12);
      expect(metrics.ordersByStatus.PAID).toBe(7);
      expect(metrics.ordersByStatus.SHIPPED).toBe(3);
      expect(metrics.ordersByStatus.COMPLETED).toBe(1);
      expect(metrics.ordersByStatus.PENDING).toBe(1);
      expect(metrics.ordersByStatus.CANCELLED).toBe(0);
      expect(metrics.totalCustomers).toBe(45);
      expect(metrics.totalActiveProducts).toBe(28);
      expect(metrics.lowStockProductCount).toBe(3);
    });
  });

  describe('findAllOrders', () => {
    it('returns filtered and paginated orders', async () => {
      const mockOrders = [
        {
          id: 'ord-1',
          status: OrderStatus.PAID,
          totalPrice: 9999,
          idempotencyKey: 'idem-1',
          expiresAt: new Date(),
          paidAt: new Date(),
          cancelledAt: null,
          createdAt: new Date(),
          user: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
          items: [{ id: 'i1' }, { id: 'i2' }],
        },
      ];

      prisma.order.findMany.mockResolvedValue(mockOrders);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllOrders({
        status: OrderStatus.PAID,
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('ord-1');
      expect(result.items[0].itemCount).toBe(2);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('findOrderById', () => {
    it('returns order with items and payment logs', async () => {
      const mockOrder = {
        id: 'ord-100',
        userId: 'u-1',
        status: OrderStatus.PAID,
        items: [],
        payments: [],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.findOrderById('ord-100');
      expect(result).toEqual(mockOrder);
    });

    it('throws NotFoundException when order is not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOrderById('missing-ord')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateOrderStatus', () => {
    it('delegates order status update to OrdersService', async () => {
      ordersService.updateStatus.mockResolvedValue({
        id: 'ord-1',
        status: OrderStatus.SHIPPED,
      });

      const result = await service.updateOrderStatus(
        'ord-1',
        OrderStatus.SHIPPED,
        adminActor,
      );

      expect(result.status).toBe(OrderStatus.SHIPPED);
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'ord-1',
        { status: OrderStatus.SHIPPED },
        adminActor,
      );
    });
  });

  describe('adjustStock', () => {
    it('delegates manual stock adjustment to InventoryService', async () => {
      inventoryService.adjustStock.mockResolvedValue({
        success: true,
        productId: 'prod-1',
        previousStock: 20,
        currentStock: 25,
      });

      const result = await service.adjustStock(
        {
          productId: 'prod-1',
          newStock: 25,
          reason: 'Physical inventory audit',
        },
        adminActor,
      );

      expect(result.currentStock).toBe(25);
      expect(inventoryService.adjustStock).toHaveBeenCalledWith(
        'prod-1',
        { newStock: 25, reason: 'Physical inventory audit' },
        adminActor.userId,
      );
    });
  });
});
