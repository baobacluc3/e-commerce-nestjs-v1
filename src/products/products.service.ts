import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product } from '../generated/prisma/client';
import { StockMovementType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, userId?: string): Promise<Product> {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    const initialStock = dto.initialStock ?? 0;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: dto.name,
            sku: dto.sku,
            slug,
            description: dto.description,
            price: dto.price,
            stock: initialStock,
            isActive: dto.isActive ?? true,
            categoryId: dto.categoryId,
          },
        });

        if (initialStock > 0) {
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: StockMovementType.IN,
              quantity: initialStock,
              balanceAfter: initialStock,
              reason: 'Initial stock intake',
              userId,
            },
          });
        }

        return product;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A product with this SKU or slug already exists',
        );
      }
      throw error;
    }
  }

  async findAll(query: QueryProductsDto): Promise<{
    items: Product[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {};
      if (query.minPrice !== undefined) {
        where.price.gte = query.minPrice;
      }
      if (query.maxPrice !== undefined) {
        where.price.lte = query.maxPrice;
      }
    }

    if (query.inStock) {
      where.stock = { gt: 0 };
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findById(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }
    return product;
  }

  async findBySku(sku: string): Promise<Product | null> {
    return this.prisma.product.findUnique({
      where: { sku },
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.findById(id);

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = slugify(dto.slug);
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }

    try {
      return await this.prisma.product.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A product with this slug already exists');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    await this.findById(id);

    // Soft-deactivate to preserve historical stock records and audit trails
    await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true, message: 'Product successfully deactivated' };
  }
}
