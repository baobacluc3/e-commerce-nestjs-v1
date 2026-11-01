import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import {
  OrderStatus,
  Role,
  StockMovementType,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    cart: {
      findUnique: jest.Mock;
    };
    cartItem: {
      deleteMany: jest.Mock;
    };
    product: {
      findUnique: jest.Mock;
    };
    order: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    stockMovement: {
      create: jest.Mock;
    };
  };

  const userA = { userId: 'user-a', role: Role.CUSTOMER };
  const userB = { userId: 'user-b', role: Role.CUSTOMER };
  const adminUser = { userId: 'admin-1', role: Role.ADMIN };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(
        <T>(callback: (tx: typeof prisma) => Promise<T>): Promise<T> =>
          callback(prisma),
      ),
      $queryRaw: jest.fn(),
      cart: {
        findUnique: jest.fn(),
      },
      cartItem: {
        deleteMany: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      stockMovement: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AppConfigService,
          useValue: { nodeEnv: 'test' },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('checkout', () => {
    it('creates an order with price snapshots, decrements stock, logs OUT movements, and clears cart', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({
        id: 'cart-a',
        userId: userA.userId,
        items: [
          {
            id: 'ci-1',
            productId: 'prod-1',
            quantity: 2,
          },
        ],
      });

      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Mechanical Keyboard',
          sku: 'KB-001',
          price: 8500,
          stock: 8, // 10 - 2
          is_active: true,
        },
      ]);

      const mockOrder = {
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 17000,
        idempotencyKey: 'idem-123',
        expiresAt: new Date(Date.now() + 1800000),
        paidAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'oi-1',
            orderId: 'ord-1',
            productId: 'prod-1',
            productName: 'Mechanical Keyboard',
            productSku: 'KB-001',
            unitPrice: 8500,
            quantity: 2,
            subtotal: 17000,
            createdAt: new Date(),
          },
        ],
      };

      prisma.order.create.mockResolvedValue(mockOrder);
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.checkout(userA.userId, 'idem-123');

      expect(result).toEqual(mockOrder);
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: userA.userId,
            status: OrderStatus.PENDING,
            totalPrice: 17000,
            idempotencyKey: 'idem-123',
            items: {
              create: [
                {
                  productId: 'prod-1',
                  productName: 'Mechanical Keyboard',
                  productSku: 'KB-001',
                  unitPrice: 8500,
                  quantity: 2,
                  subtotal: 17000,
                },
              ],
            },
          }) as unknown,
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-1',
          type: StockMovementType.OUT,
          quantity: 2,
          balanceAfter: 8,
          reason: 'Order checkout',
          referenceId: 'ord-1',
          userId: userA.userId,
        },
      });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-a' },
      });
    });

    it('throws BadRequestException when cart is empty', async () => {
      prisma.cart.findUnique.mockResolvedValue({
        id: 'cart-a',
        userId: userA.userId,
        items: [],
      });

      await expect(service.checkout(userA.userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('aborts checkout (all-or-nothing) when any item has insufficient stock', async () => {
      prisma.cart.findUnique.mockResolvedValue({
        id: 'cart-a',
        userId: userA.userId,
        items: [
          { id: 'ci-1', productId: 'prod-1', quantity: 1 },
          { id: 'ci-2', productId: 'prod-2', quantity: 5 },
        ],
      });

      // First product succeeds, second product fails stock check (0 rows updated)
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 'prod-1',
            name: 'Item 1',
            sku: 'SKU-1',
            price: 1000,
            stock: 4,
            is_active: true,
          },
        ])
        .mockResolvedValueOnce([]);

      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-2',
        name: 'Item 2',
        stock: 2,
        isActive: true,
      });

      await expect(service.checkout(userA.userId)).rejects.toThrow(
        ConflictException,
      );

      // Order must not be created and cart must not be cleared
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('idempotency: returns existing order without creating a second order on repeated request', async () => {
      const existingOrder = {
        id: 'ord-existing',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 5000,
        idempotencyKey: 'double-click-key',
        items: [],
      };

      prisma.order.findUnique.mockResolvedValue(existingOrder);

      const result = await service.checkout(userA.userId, 'double-click-key');

      expect(result).toEqual(existingOrder);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('idempotency: handles parallel double-click P2002 race condition by returning the winning order', async () => {
      const winningOrder = {
        id: 'ord-winner',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 5000,
        idempotencyKey: 'race-key',
        items: [],
      };

      // Pre-check returns null for both parallel requests, then transaction throws P2002, then recovery lookup returns winningOrder
      prisma.order.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winningOrder);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on (user_id, idempotency_key)',
        { code: 'P2002', clientVersion: '7.10.1' },
      );
      prisma.$transaction.mockRejectedValueOnce(p2002Error);

      const result = await service.checkout(userA.userId, 'race-key');

      expect(result).toEqual(winningOrder);
    });
  });

  describe('findOne & access control', () => {
    const orderOwnedByUserA = {
      id: 'ord-a',
      userId: userA.userId,
      status: OrderStatus.PENDING,
      totalPrice: 3000,
      items: [],
    };

    it('allows the owner to read their own order', async () => {
      prisma.order.findUnique.mockResolvedValue(orderOwnedByUserA);

      const result = await service.findOne('ord-a', userA);
      expect(result).toEqual(orderOwnedByUserA);
    });

    it('forbids another customer from reading the order (403 Forbidden)', async () => {
      prisma.order.findUnique.mockResolvedValue(orderOwnedByUserA);

      await expect(service.findOne('ord-a', userB)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows an ADMIN to read any order', async () => {
      prisma.order.findUnique.mockResolvedValue(orderOwnedByUserA);

      const result = await service.findOne('ord-a', adminUser);
      expect(result).toEqual(orderOwnedByUserA);
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id', userA)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('mockPay', () => {
    it('transitions a PENDING order to PAID', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 4000,
        expiresAt: new Date(Date.now() + 600000),
        items: [],
      });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.mockPay('ord-1', userA);

      expect(result.status).toBe(OrderStatus.PAID);
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('rejects payment when order has expired', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-expired',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 4000,
        expiresAt: new Date(Date.now() - 1000), // in the past
        items: [],
      });

      await expect(service.mockPay('ord-expired', userA)).rejects.toThrow(
        ConflictException,
      );
    });

    it('forbids another user from paying for the order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        expiresAt: new Date(Date.now() + 600000),
        items: [],
      });

      await expect(service.mockPay('ord-1', userB)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('cancelOrder & restock', () => {
    it('cancels a PENDING order and atomically restocks inventory with IN movements', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-cancel-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 6000,
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            quantity: 3,
          },
        ],
      });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', stock: 13 }]);
      prisma.stockMovement.create.mockResolvedValue({});

      const result = await service.cancelOrder('ord-cancel-1', userA, {
        reason: 'Changed mind',
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-1',
          type: StockMovementType.IN,
          quantity: 3,
          balanceAfter: 13,
          reason: 'Changed mind',
          referenceId: 'ord-cancel-1',
          userId: userA.userId,
        },
      });
    });

    it('throws ConflictException when trying to cancel an already SHIPPED order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-shipped',
        userId: userA.userId,
        status: OrderStatus.SHIPPED,
        items: [],
      });

      await expect(service.cancelOrder('ord-shipped', userA)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateStatus (state machine)', () => {
    it('allows valid transition PAID -> SHIPPED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PAID,
        items: [],
      });
      prisma.order.update.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.SHIPPED,
        items: [],
      });

      const result = await service.updateStatus(
        'ord-1',
        { status: OrderStatus.SHIPPED },
        adminUser,
      );
      expect(result.status).toBe(OrderStatus.SHIPPED);
    });

    it('rejects invalid transition PENDING -> COMPLETED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        items: [],
      });

      await expect(
        service.updateStatus(
          'ord-1',
          { status: OrderStatus.COMPLETED },
          adminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('expireUnpaidOrders', () => {
    it('cancels expired PENDING orders and restocks their items', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'ord-exp-1',
          userId: userA.userId,
          status: OrderStatus.PENDING,
          expiresAt: new Date(Date.now() - 60000),
          items: [{ id: 'oi-1', productId: 'prod-1', quantity: 2 }],
        },
      ]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', stock: 12 }]);
      prisma.stockMovement.create.mockResolvedValue({});

      const summary = await service.expireUnpaidOrders();

      expect(summary).toEqual({
        expiredCount: 1,
        expiredOrderIds: ['ord-exp-1'],
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-1',
          type: StockMovementType.IN,
          quantity: 2,
          balanceAfter: 12,
          reason: 'Order expired (unpaid)',
          referenceId: 'ord-exp-1',
          userId: null,
        },
      });
    });
  });
});
