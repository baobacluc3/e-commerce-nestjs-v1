import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StockMovementType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    product: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    stockMovement: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(
        <T>(callback: (tx: typeof prisma) => Promise<T>): Promise<T> =>
          callback(prisma),
      ),
      $queryRaw: jest.fn(),
      product: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      stockMovement: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  describe('decrementStock', () => {
    it('atomically decrements stock and creates an OUT movement', async () => {
      // Raw SQL returns the updated row with stock = 8 (started at 10, subtracted 2)
      prisma.$queryRaw.mockResolvedValue([
        { id: 'p1', stock: 8, is_active: true },
      ]);
      const mockMovement = {
        id: 'mov-out-1',
        productId: 'p1',
        type: StockMovementType.OUT,
        quantity: 2,
        balanceAfter: 8,
        reason: 'Customer purchase',
      };
      prisma.stockMovement.create.mockResolvedValue(mockMovement);

      const result = await service.decrementStock(
        'p1',
        { quantity: 2, reason: 'Customer purchase' },
        'user-1',
      );

      expect(result.success).toBe(true);
      expect(result.previousStock).toBe(10);
      expect(result.currentStock).toBe(8);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'p1',
          type: StockMovementType.OUT,
          quantity: 2,
          balanceAfter: 8,
          reason: 'Customer purchase',
          referenceId: undefined,
          userId: 'user-1',
        },
      });
    });

    it('throws ConflictException when product stock is insufficient', async () => {
      // Conditional atomic update matched 0 rows because stock < quantity
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Gaming Mouse',
        stock: 1,
        isActive: true,
      });

      await expect(
        service.decrementStock('p1', { quantity: 5 }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when product is inactive', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Discontinued Item',
        stock: 10,
        isActive: false,
      });

      await expect(
        service.decrementStock('p1', { quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.decrementStock('non-existent-id', { quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('restock', () => {
    it('atomically increments stock and creates an IN movement', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'p1', stock: 50, is_active: true },
      ]);
      const mockMovement = {
        id: 'mov-in-1',
        productId: 'p1',
        type: StockMovementType.IN,
        quantity: 20,
        balanceAfter: 50,
      };
      prisma.stockMovement.create.mockResolvedValue(mockMovement);

      const result = await service.restock(
        'p1',
        { quantity: 20, reason: 'New shipment' },
        'admin-1',
      );

      expect(result.success).toBe(true);
      expect(result.previousStock).toBe(30);
      expect(result.currentStock).toBe(50);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'p1',
          type: StockMovementType.IN,
          quantity: 20,
          balanceAfter: 50,
          reason: 'New shipment',
          referenceId: undefined,
          userId: 'admin-1',
        },
      });
    });
  });

  describe('adjustStock', () => {
    it('sets stock to target count and logs ADJUSTMENT with delta', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'Item',
        stock: 15,
        isActive: true,
      });
      prisma.product.update.mockResolvedValue({ id: 'p1', stock: 20 });
      prisma.stockMovement.create.mockResolvedValue({
        id: 'mov-adj-1',
        productId: 'p1',
        type: StockMovementType.ADJUSTMENT,
        quantity: 5,
        balanceAfter: 20,
      });

      const result = await service.adjustStock(
        'p1',
        { newStock: 20, reason: 'Annual count adjustment' },
        'auditor-1',
      );

      expect(result.success).toBe(true);
      expect(result.previousStock).toBe(15);
      expect(result.currentStock).toBe(20);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'p1',
          type: StockMovementType.ADJUSTMENT,
          quantity: 5,
          balanceAfter: 20,
          reason: 'Annual count adjustment',
          userId: 'auditor-1',
        },
      });
    });
  });

  describe('getStock', () => {
    it('returns product stock status and availability', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        name: 'In-stock Item',
        sku: 'SKU-001',
        stock: 10,
        isActive: true,
      });

      const result = await service.getStock('p1');
      expect(result).toEqual({
        productId: 'p1',
        name: 'In-stock Item',
        sku: 'SKU-001',
        stock: 10,
        isAvailable: true,
        isActive: true,
      });
    });

    it('reports isAvailable: false when stock is 0', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p2',
        name: 'Out-of-stock Item',
        sku: 'SKU-002',
        stock: 0,
        isActive: true,
      });

      const result = await service.getStock('p2');
      expect(result.isAvailable).toBe(false);
      expect(result.stock).toBe(0);
    });
  });

  describe('getLowStock', () => {
    it('returns active products at or below threshold', async () => {
      const mockItems = [
        {
          id: 'p1',
          name: 'Low Stock Item',
          sku: 'SKU-LOW',
          stock: 2,
          isActive: true,
        },
      ];
      prisma.product.findMany.mockResolvedValue(mockItems);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.getLowStock(5);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].stock).toBe(2);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stock: { lte: 5 }, isActive: true },
          orderBy: { stock: 'asc' },
        }),
      );
    });
  });

  describe('concurrency: race condition prevention for last item', () => {
    it('when 2 concurrent requests compete for the last item, exactly 1 succeeds and 1 fails', async () => {
      // Simulate database state: stock is initially 1
      let currentStockInDb = 1;

      // Mock transaction simulation where atomic UPDATE checks stock >= quantity
      prisma.$transaction.mockImplementation(
        <T>(
          callback: (tx: {
            $queryRaw: jest.Mock;
            product: { findUnique: jest.Mock };
            stockMovement: { create: jest.Mock };
          }) => Promise<T>,
        ): Promise<T> => {
          const txPrisma = {
            $queryRaw: jest.fn().mockImplementation(() => {
              // Atomic conditional update simulation
              if (currentStockInDb >= 1) {
                currentStockInDb -= 1;
                return Promise.resolve([
                  { id: 'p-last', stock: currentStockInDb, is_active: true },
                ]);
              }
              return Promise.resolve([]); // 0 rows updated
            }),
            product: {
              findUnique: jest.fn().mockImplementation(() =>
                Promise.resolve({
                  id: 'p-last',
                  name: 'Last Standing Widget',
                  stock: currentStockInDb,
                  isActive: true,
                }),
              ),
            },
            stockMovement: {
              create: jest.fn().mockResolvedValue({ id: 'mov-last' }),
            },
          };
          return callback(txPrisma);
        },
      );

      // Launch 2 parallel decrement requests for the last remaining unit
      const [result1, result2] = await Promise.allSettled([
        service.decrementStock('p-last', { quantity: 1 }),
        service.decrementStock('p-last', { quantity: 1 }),
      ]);

      const successes = [result1, result2].filter(
        (r) => r.status === 'fulfilled',
      );
      const rejections = [result1, result2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      // Exactly one request must succeed and exactly one must fail with ConflictException
      expect(successes).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(rejections[0].reason).toBeInstanceOf(ConflictException);
      expect(currentStockInDb).toBe(0);
    });
  });
});
