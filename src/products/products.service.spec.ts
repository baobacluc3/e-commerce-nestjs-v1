import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { StockMovementType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    $transaction: jest.Mock;
    product: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    stockMovement: {
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(
        <T>(callback: (tx: typeof prisma) => Promise<T>): Promise<T> =>
          callback(prisma),
      ),
      product: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      stockMovement: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    it('creates a product with generated slug and 0 initial stock when initialStock is omitted', async () => {
      const mockCreated = {
        id: 'prod-1',
        name: 'Wireless Mouse',
        slug: 'wireless-mouse',
        sku: 'MS-W-01',
        price: 2999,
        stock: 0,
        isActive: true,
      };

      prisma.product.create.mockResolvedValue(mockCreated);

      const result = await service.create({
        name: 'Wireless Mouse',
        sku: 'MS-W-01',
        price: 2999,
      });

      expect(result).toEqual(mockCreated);
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          name: 'Wireless Mouse',
          sku: 'MS-W-01',
          slug: 'wireless-mouse',
          description: undefined,
          price: 2999,
          stock: 0,
          isActive: true,
          categoryId: undefined,
        },
      });
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('records an initial stock movement when initialStock > 0', async () => {
      const mockCreated = {
        id: 'prod-2',
        name: 'Mechanical Keyboard',
        slug: 'mech-kb',
        sku: 'KB-M-01',
        price: 8999,
        stock: 25,
        isActive: true,
      };

      prisma.product.create.mockResolvedValue(mockCreated);
      prisma.stockMovement.create.mockResolvedValue({ id: 'mov-1' });

      const result = await service.create(
        {
          name: 'Mechanical Keyboard',
          slug: 'mech-kb',
          sku: 'KB-M-01',
          price: 8999,
          initialStock: 25,
        },
        'user-admin-1',
      );

      expect(result).toEqual(mockCreated);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-2',
          type: StockMovementType.IN,
          quantity: 25,
          balanceAfter: 25,
          reason: 'Initial stock intake',
          userId: 'user-admin-1',
        },
      });
    });

    it('throws ConflictException on P2002 duplicate key constraint', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        { code: 'P2002', clientVersion: '7.10.1' },
      );
      prisma.product.create.mockRejectedValue(p2002Error);

      await expect(
        service.create({
          name: 'Duplicate Item',
          sku: 'DUP-SKU',
          price: 1000,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns paginated products and total count', async () => {
      const mockItems = [{ id: 'p1', name: 'Item 1', stock: 10 }];
      prisma.product.findMany.mockResolvedValue(mockItems);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual({
        items: mockItems,
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('findById', () => {
    it('returns product when found', async () => {
      const mockProduct = { id: 'p1', name: 'Found Product' };
      prisma.product.findUnique.mockResolvedValue(mockProduct);

      const result = await service.findById('p1');
      expect(result).toEqual(mockProduct);
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deactivates product', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', isActive: true });
      prisma.product.update.mockResolvedValue({ id: 'p1', isActive: false });

      const result = await service.remove('p1');
      expect(result.success).toBe(true);
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isActive: false },
      });
    });
  });
});
