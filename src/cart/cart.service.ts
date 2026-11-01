import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartItemResponseDto, CartResponseDto } from './dto/cart-response.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

interface CartWithItems {
  id: string;
  userId: string;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    product: {
      id: string;
      name: string;
      sku: string;
      price: number;
      stock: number;
      isActive: boolean;
    };
  }>;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the user's cart or creates one if it does not yet exist.
   */
  async getOrCreateCart(
    userId: string,
  ): Promise<{ id: string; userId: string }> {
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { id: true, userId: true },
    });
  }

  /**
   * Retrieves the user's cart with live server-calculated prices,
   * subtotals, availability checks, and checkout readiness.
   */
  async getCart(userId: string): Promise<CartResponseDto> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                stock: true,
                isActive: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return this.mapCartResponse(cart);
  }

  /**
   * Adds an item to the cart or increments quantity if already present.
   * Validates product existence, active status, and available inventory.
   */
  async addItem(userId: string, dto: AddCartItemDto): Promise<CartResponseDto> {
    const { productId, quantity = 1 } = dto;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, isActive: true },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID '${productId}' not found`);
    }

    if (!product.isActive) {
      throw new BadRequestException(
        `Cannot add product '${product.name}' to cart: product is inactive`,
      );
    }

    if (product.stock <= 0) {
      throw new ConflictException(
        `Product '${product.name}' is currently out of stock`,
      );
    }

    const cart = await this.getOrCreateCart(userId);

    const existingItem = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    const targetQuantity = existingItem
      ? existingItem.quantity + quantity
      : quantity;

    if (targetQuantity > product.stock) {
      throw new ConflictException(
        `Cannot add ${quantity} units: requested total (${targetQuantity}) exceeds available stock (${product.stock})`,
      );
    }

    await this.prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
      update: {
        quantity: targetQuantity,
      },
      create: {
        cartId: cart.id,
        productId,
        quantity,
      },
    });

    return this.getCart(userId);
  }

  /**
   * Updates the quantity of an item in the user's cart.
   * Validates against live inventory stock.
   */
  async updateItem(
    userId: string,
    cartItemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    const { quantity } = dto;

    const cart = await this.getOrCreateCart(userId);

    const cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: cartItemId,
        cartId: cart.id,
      },
      include: {
        product: {
          select: { id: true, name: true, stock: true, isActive: true },
        },
      },
    });

    if (!cartItem) {
      throw new NotFoundException(
        `Cart item '${cartItemId}' not found in user's cart`,
      );
    }

    if (!cartItem.product.isActive) {
      throw new BadRequestException(
        `Product '${cartItem.product.name}' is no longer active`,
      );
    }

    if (quantity > cartItem.product.stock) {
      throw new ConflictException(
        `Cannot update quantity to ${quantity}: only ${cartItem.product.stock} units available in stock`,
      );
    }

    await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
    });

    return this.getCart(userId);
  }

  /**
   * Removes an individual item from the user's cart.
   */
  async removeItem(
    userId: string,
    cartItemId: string,
  ): Promise<CartResponseDto> {
    const cart = await this.getOrCreateCart(userId);

    const cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: cartItemId,
        cartId: cart.id,
      },
    });

    if (!cartItem) {
      throw new NotFoundException(
        `Cart item '${cartItemId}' not found in user's cart`,
      );
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    return this.getCart(userId);
  }

  /**
   * Empties all items from the user's cart.
   */
  async clearCart(
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const cart = await this.getOrCreateCart(userId);

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return { success: true, message: 'Cart cleared successfully' };
  }

  /**
   * Calculates live pricing, subtotals, and availability flags.
   */
  private mapCartResponse(cart: CartWithItems): CartResponseDto {
    let totalItems = 0;
    let totalPrice = 0;
    let allAvailable = cart.items.length > 0;

    const items: CartItemResponseDto[] = cart.items.map((item) => {
      const { product, quantity } = item;
      const unitPrice = product.price;
      const subtotal = unitPrice * quantity;
      const isAvailable = product.isActive && product.stock >= quantity;

      let availabilityNotice: string | undefined;
      if (!product.isActive) {
        availabilityNotice = 'Product is no longer available';
      } else if (product.stock === 0) {
        availabilityNotice = 'Product is out of stock';
      } else if (product.stock < quantity) {
        availabilityNotice = `Only ${product.stock} units available`;
      }

      totalItems += quantity;
      if (isAvailable) {
        totalPrice += subtotal;
      } else {
        allAvailable = false;
      }

      return {
        id: item.id,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        unitPrice,
        quantity,
        subtotal,
        availableStock: product.stock,
        isAvailable,
        availabilityNotice,
      };
    });

    return {
      id: cart.id,
      userId: cart.userId,
      items,
      totalItems,
      totalPrice,
      isCheckoutReady: allAvailable && cart.items.length > 0,
      updatedAt: cart.updatedAt,
    };
  }
}
