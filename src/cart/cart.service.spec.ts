import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

describe('CartService', () => {
  let service: CartService;
  let prisma: {
    cart: {
      upsert: jest.Mock;
    };
    cartItem: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    product: {
      findUnique: jest.Mock;
    };
  };

  const mockCartId = 'cart-uuid-1';
  const mockUserId = 'user-uuid-1';

  beforeEach(async () => {
    prisma = {
      cart: {
        upsert: jest.fn(),
      },
      cartItem: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe('getCart', () => {
    it('returns empty cart with total 0 and isCheckoutReady false', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        items: [],
        updatedAt: new Date(),
      });

      const result = await service.getCart(mockUserId);

      expect(result.id).toBe(mockCartId);
      expect(result.userId).toBe(mockUserId);
      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(0);
      expect(result.totalPrice).toBe(0);
      expect(result.isCheckoutReady).toBe(false);
    });

    it('calculates totals and availability server-side using current product prices', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        updatedAt: new Date(),
        items: [
          {
            id: 'item-1',
            quantity: 2,
            product: {
              id: 'prod-1',
              name: 'Mechanical Keyboard',
              sku: 'KB-001',
              price: 5000, // $50.00 each
              stock: 10,
              isActive: true,
            },
          },
          {
            id: 'item-2',
            quantity: 1,
            product: {
              id: 'prod-2',
              name: 'Mousepad',
              sku: 'MP-001',
              price: 1500, // $15.00
              stock: 5,
              isActive: true,
            },
          },
        ],
      });

      const result = await service.getCart(mockUserId);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].subtotal).toBe(10000); // 5000 * 2
      expect(result.items[1].subtotal).toBe(1500); // 1500 * 1
      expect(result.totalItems).toBe(3);
      expect(result.totalPrice).toBe(11500); // 10000 + 1500
      expect(result.isCheckoutReady).toBe(true);
      expect(result.items[0].isAvailable).toBe(true);
      expect(result.items[1].isAvailable).toBe(true);
    });

    it('flags item as not available and isCheckoutReady as false if quantity exceeds stock', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        updatedAt: new Date(),
        items: [
          {
            id: 'item-1',
            quantity: 5,
            product: {
              id: 'prod-1',
              name: 'Limited Edition Keycap',
              sku: 'KC-001',
              price: 2000,
              stock: 2, // only 2 left in stock
              isActive: true,
            },
          },
        ],
      });

      const result = await service.getCart(mockUserId);

      expect(result.items[0].isAvailable).toBe(false);
      expect(result.items[0].availabilityNotice).toBe('Only 2 units available');
      expect(result.isCheckoutReady).toBe(false);
    });
  });

  describe('addItem', () => {
    it('adds new product to cart when in stock', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Desk Mat',
        stock: 10,
        isActive: true,
      });

      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        items: [],
        updatedAt: new Date(),
      });

      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.upsert.mockResolvedValue({});

      await service.addItem(mockUserId, {
        productId: 'prod-1',
        quantity: 2,
      });

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: {
          cartId_productId: {
            cartId: mockCartId,
            productId: 'prod-1',
          },
        },
        update: { quantity: 2 },
        create: {
          cartId: mockCartId,
          productId: 'prod-1',
          quantity: 2,
        },
      });
    });

    it('increments quantity when product is already in cart', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Desk Mat',
        stock: 10,
        isActive: true,
      });

      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        items: [],
        updatedAt: new Date(),
      });

      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'item-1',
        cartId: mockCartId,
        productId: 'prod-1',
        quantity: 3,
      });
      prisma.cartItem.upsert.mockResolvedValue({});

      await service.addItem(mockUserId, {
        productId: 'prod-1',
        quantity: 2,
      });

      // Target quantity is 3 + 2 = 5
      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: {
          cartId_productId: {
            cartId: mockCartId,
            productId: 'prod-1',
          },
        },
        update: { quantity: 5 },
        create: {
          cartId: mockCartId,
          productId: 'prod-1',
          quantity: 2,
        },
      });
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(mockUserId, { productId: 'invalid-id', quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when product is inactive', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Archived Keyboard',
        stock: 5,
        isActive: false,
      });

      await expect(
        service.addItem(mockUserId, { productId: 'prod-1', quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when product is out of stock', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Out of Stock Monitor',
        stock: 0,
        isActive: true,
      });

      await expect(
        service.addItem(mockUserId, { productId: 'prod-1', quantity: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when requested quantity exceeds available stock', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Low Stock Mouse',
        stock: 3,
        isActive: true,
      });

      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
      });

      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'item-1',
        quantity: 2,
      });

      // 2 already in cart + 2 new requested = 4 > stock 3
      await expect(
        service.addItem(mockUserId, { productId: 'prod-1', quantity: 2 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateItem', () => {
    it('updates item quantity when within stock limit', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        items: [],
        updatedAt: new Date(),
      });

      prisma.cartItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cartId: mockCartId,
        quantity: 1,
        product: {
          id: 'prod-1',
          name: 'Item',
          stock: 10,
          isActive: true,
        },
      });

      prisma.cartItem.update.mockResolvedValue({});

      await service.updateItem(mockUserId, 'item-1', { quantity: 4 });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: 4 },
      });
    });

    it('throws NotFoundException when cart item does not exist', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
      });
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem(mockUserId, 'non-existent', { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new quantity exceeds stock', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
      });

      prisma.cartItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 1,
        product: {
          id: 'prod-1',
          name: 'Rare Item',
          stock: 3,
          isActive: true,
        },
      });

      await expect(
        service.updateItem(mockUserId, 'item-1', { quantity: 5 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeItem', () => {
    it('removes item from user cart', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
        items: [],
        updatedAt: new Date(),
      });

      prisma.cartItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cartId: mockCartId,
      });
      prisma.cartItem.delete.mockResolvedValue({});

      await service.removeItem(mockUserId, 'item-1');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
    });

    it('throws NotFoundException if item does not belong to user', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
      });
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeItem(mockUserId, 'foreign-item'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearCart', () => {
    it('clears all items in the user cart', async () => {
      prisma.cart.upsert.mockResolvedValue({
        id: mockCartId,
        userId: mockUserId,
      });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.clearCart(mockUserId);

      expect(result.success).toBe(true);
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: mockCartId },
      });
    });
  });
});
