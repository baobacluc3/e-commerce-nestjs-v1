import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import {
  OrderStatus,
  Role,
  StockMovementType,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OrderExpirationQueueService } from '../queues/order-expiration.queue';
import type {
  DeadLetterJobData,
  OrderExpirationJobResult,
} from '../queues/queue.constants';
import { CancelOrderDto } from './dto/cancel-order.dto';
import {
  OrderResponseDto,
  PaginatedOrdersResponseDto,
} from './dto/order-response.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

export const ORDER_PAYMENT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EXPIRY_SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute fallback sweep

interface DecrementedProductRow {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  is_active: boolean;
}

interface RestockedProductRow {
  id: string;
  stock: number;
}

const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional()
    private readonly orderExpirationQueue?: OrderExpirationQueueService,
  ) {
    if (this.orderExpirationQueue) {
      this.orderExpirationQueue.registerProcessor((data) =>
        this.expireOrder(data.orderId),
      );
    }
  }

  onModuleInit(): void {
    // Run periodic sweep for unpaid expired orders outside of test runs
    if (this.config.nodeEnv !== 'test' && process.env.NODE_ENV !== 'test') {
      this.expiryTimer = setInterval(() => {
        void this.expireUnpaidOrders().catch(() => {
          // Sweep errors are non-fatal to the process
        });
      }, EXPIRY_SWEEP_INTERVAL_MS);
      this.expiryTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
    }
  }

  /**
   * Executes an all-or-nothing checkout in a single database transaction:
   * 1. Enforces idempotency if an idempotencyKey is provided.
   * 2. Reads user's cart items.
   * 3. Atomically decrements product stock in deterministic order and logs OUT movements.
   * 4. Snapshots live product prices into Order and OrderItems.
   * 5. Clears the user's cart.
   */
  async checkout(
    userId: string,
    rawIdempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    const idempotencyKey = rawIdempotencyKey?.trim() || undefined;

    const ttlMs = this.config.orderExpiryDelayMs ?? ORDER_PAYMENT_TTL_MS;

    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey },
        },
        include: { items: true },
      });
      if (existing) {
        if (existing.status === OrderStatus.PENDING) {
          await this.scheduleOrderExpiration(existing, ttlMs);
        }
        return existing;
      }
    }

    try {
      const createdOrder = await this.prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existingInTx = await tx.order.findUnique({
            where: {
              userId_idempotencyKey: { userId, idempotencyKey },
            },
            include: { items: true },
          });
          if (existingInTx) {
            return existingInTx;
          }
        }

        const cart = await tx.cart.findUnique({
          where: { userId },
          include: {
            items: true,
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new BadRequestException('Cannot checkout an empty cart');
        }

        // Sort by productId ascending to guarantee a consistent lock order across concurrent transactions
        const sortedCartItems = [...cart.items].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        );

        let totalPrice = 0;
        const snapshots: Array<{
          productId: string;
          productName: string;
          productSku: string;
          unitPrice: number;
          quantity: number;
          subtotal: number;
          balanceAfter: number;
        }> = [];

        for (const cartItem of sortedCartItems) {
          const updatedRows = await tx.$queryRaw<DecrementedProductRow[]>`
            UPDATE products
            SET stock = stock - ${cartItem.quantity}, updated_at = NOW()
            WHERE id = ${cartItem.productId}::uuid
              AND stock >= ${cartItem.quantity}
              AND is_active = true
            RETURNING id, name, sku, price, stock, is_active
          `;

          if (updatedRows.length === 0) {
            const product = await tx.product.findUnique({
              where: { id: cartItem.productId },
              select: { id: true, name: true, stock: true, isActive: true },
            });

            if (!product) {
              throw new NotFoundException(
                `Product with ID '${cartItem.productId}' not found`,
              );
            }
            if (!product.isActive) {
              throw new BadRequestException(
                `Product '${product.name}' is no longer active`,
              );
            }
            throw new ConflictException(
              `Insufficient stock for product '${product.name}'. Available: ${product.stock}, requested: ${cartItem.quantity}`,
            );
          }

          const updatedProduct = updatedRows[0];
          const unitPrice = updatedProduct.price;
          const subtotal = unitPrice * cartItem.quantity;
          totalPrice += subtotal;

          snapshots.push({
            productId: updatedProduct.id,
            productName: updatedProduct.name,
            productSku: updatedProduct.sku,
            unitPrice,
            quantity: cartItem.quantity,
            subtotal,
            balanceAfter: updatedProduct.stock,
          });
        }

        const expiresAt = new Date(Date.now() + ttlMs);

        const order = await tx.order.create({
          data: {
            userId,
            status: OrderStatus.PENDING,
            totalPrice,
            idempotencyKey: idempotencyKey ?? null,
            expiresAt,
            items: {
              create: snapshots.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                productSku: item.productSku,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                subtotal: item.subtotal,
              })),
            },
          },
          include: {
            items: true,
          },
        });

        for (const item of snapshots) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: StockMovementType.OUT,
              quantity: item.quantity,
              balanceAfter: item.balanceAfter,
              reason: 'Order checkout',
              referenceId: order.id,
              userId,
            },
          });
        }

        await tx.cartItem.deleteMany({
          where: { cartId: cart.id },
        });

        return order;
      });

      if (createdOrder.status === OrderStatus.PENDING) {
        await this.scheduleOrderExpiration(createdOrder, ttlMs);
      }

      return createdOrder;
    } catch (error) {
      // Handle race condition where two parallel requests with the same idempotencyKey collide on unique index
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winningOrder = await this.prisma.order.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey },
          },
          include: { items: true },
        });
        if (winningOrder) {
          if (winningOrder.status === OrderStatus.PENDING) {
            await this.scheduleOrderExpiration(winningOrder, ttlMs);
          }
          return winningOrder;
        }
      }
      throw error;
    }
  }

  /**
   * Lists orders belonging to a specific user with pagination and optional status filter.
   */
  async findAllForUser(
    userId: string,
    query: QueryOrdersDto,
  ): Promise<PaginatedOrdersResponseDto> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves a single order by ID.
   * Enforces strict ownership: a customer can only read their own orders; ADMIN can read any.
   */
  async findOne(orderId: string, actor: AuthUser): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID '${orderId}' not found`);
    }

    if (order.userId !== actor.userId && actor.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Forbidden: you do not have permission to view this order',
      );
    }

    return order;
  }

  /**
   * Temporary mock payment endpoint (for Phase 5 prior to Stripe in Phase 7).
   * Transitions a PENDING, non-expired order to PAID.
   */
  async mockPay(orderId: string, actor: AuthUser): Promise<OrderResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID '${orderId}' not found`);
      }

      if (order.userId !== actor.userId && actor.role !== Role.ADMIN) {
        throw new ForbiddenException(
          'Forbidden: you do not have permission to pay for this order',
        );
      }

      if (order.status === OrderStatus.PAID) {
        return order;
      }

      if (order.status !== OrderStatus.PENDING) {
        throw new ConflictException(
          `Cannot pay for order in '${order.status}' status`,
        );
      }

      if (order.expiresAt <= new Date()) {
        throw new ConflictException(
          'Order has expired and can no longer be paid',
        );
      }

      const paidAt = new Date();
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.PENDING,
        },
        data: {
          status: OrderStatus.PAID,
          paidAt,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'Order status changed concurrently and could not be paid',
        );
      }

      return {
        ...order,
        status: OrderStatus.PAID,
        paidAt,
      };
    });
  }

  /**
   * Cancels a PENDING or PAID order and atomically restocks all items into inventory.
   */
  async cancelOrder(
    orderId: string,
    actor: AuthUser,
    dto?: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID '${orderId}' not found`);
      }

      if (order.userId !== actor.userId && actor.role !== Role.ADMIN) {
        throw new ForbiddenException(
          'Forbidden: you do not have permission to cancel this order',
        );
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException('Order is already cancelled');
      }

      if (
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.PAID
      ) {
        throw new ConflictException(
          `Cannot cancel order in '${order.status}' status`,
        );
      }

      const cancelledAt = new Date();
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'Order could not be cancelled due to concurrent status update',
        );
      }

      const sortedItems = [...order.items].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      );

      for (const item of sortedItems) {
        const restockedRows = await tx.$queryRaw<RestockedProductRow[]>`
          UPDATE products
          SET stock = stock + ${item.quantity}, updated_at = NOW()
          WHERE id = ${item.productId}::uuid
          RETURNING id, stock
        `;

        if (restockedRows.length > 0) {
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: StockMovementType.IN,
              quantity: item.quantity,
              balanceAfter: restockedRows[0].stock,
              reason: dto?.reason ?? 'Order cancelled restock',
              referenceId: order.id,
              userId: actor.userId,
            },
          });
        }
      }

      return {
        ...order,
        status: OrderStatus.CANCELLED,
        cancelledAt,
      };
    });
  }

  /**
   * Transitions order status (Admin only).
   * Enforces state machine rules and delegates to cancelOrder if transitioning to CANCELLED.
   */
  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    actor: AuthUser,
  ): Promise<OrderResponseDto> {
    if (dto.status === OrderStatus.CANCELLED) {
      return this.cancelOrder(orderId, actor, {
        reason: 'Order cancelled by admin',
      });
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID '${orderId}' not found`);
    }

    const allowedTargets = VALID_STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowedTargets.includes(dto.status)) {
      throw new ConflictException(
        `Invalid status transition from '${order.status}' to '${dto.status}'`,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        ...(dto.status === OrderStatus.PAID ? { paidAt: new Date() } : {}),
      },
      include: { items: true },
    });
  }

  /**
   * Atomically expires a single unpaid PENDING order and restocks all reserved inventory.
   * Strictly idempotent: running the same job twice (or on a PAID/CANCELLED/SHIPPED order)
   * changes nothing in the database.
   * All-or-nothing: if the worker is killed mid-transaction, PostgreSQL rolls back completely.
   */
  async expireOrder(
    orderId: string,
    preloadedOrder?: {
      id: string;
      status: OrderStatus;
      items: Array<{ productId: string; quantity: number }>;
    },
  ): Promise<OrderExpirationJobResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const order =
        preloadedOrder ??
        (await tx.order.findUnique({
          where: { id: orderId },
          include: { items: true },
        }));

      if (!order) {
        return {
          orderId,
          cancelled: false,
          status: 'NOT_FOUND',
          restockedItemsCount: 0,
          idempotentSkip: true,
        };
      }

      if (order.status !== OrderStatus.PENDING) {
        return {
          orderId,
          cancelled: false,
          status: order.status,
          restockedItemsCount: 0,
          idempotentSkip: true,
        };
      }

      const updated = await tx.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.PENDING,
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: now,
        },
      });

      if (updated.count === 0) {
        return {
          orderId,
          cancelled: false,
          status: OrderStatus.CANCELLED,
          restockedItemsCount: 0,
          idempotentSkip: true,
        };
      }

      const sortedItems = [...order.items].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      );

      let restockedItemsCount = 0;

      for (const item of sortedItems) {
        const restockedRows = await tx.$queryRaw<RestockedProductRow[]>`
          UPDATE products
          SET stock = stock + ${item.quantity}, updated_at = NOW()
          WHERE id = ${item.productId}::uuid
          RETURNING id, stock
        `;

        if (restockedRows.length > 0) {
          restockedItemsCount += 1;
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: StockMovementType.IN,
              quantity: item.quantity,
              balanceAfter: restockedRows[0].stock,
              reason: 'Order expired (unpaid)',
              referenceId: order.id,
              userId: null,
            },
          });
        }
      }

      return {
        orderId,
        cancelled: true,
        status: OrderStatus.CANCELLED,
        restockedItemsCount,
        idempotentSkip: false,
      };
    });
  }

  /**
   * Finds all PENDING orders whose expiresAt timestamp has passed,
   * cancels them atomically, and restocks their reserved items.
   */
  async expireUnpaidOrders(): Promise<{
    expiredCount: number;
    expiredOrderIds: string[];
  }> {
    const now = new Date();
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        expiresAt: { lte: now },
      },
      include: { items: true },
    });

    const expiredOrderIds: string[] = [];

    for (const order of expiredOrders) {
      const result = await this.expireOrder(order.id, order);
      if (result.cancelled) {
        expiredOrderIds.push(order.id);
      }
    }

    return {
      expiredCount: expiredOrderIds.length,
      expiredOrderIds,
    };
  }

  getDeadLetterJobs(): DeadLetterJobData[] {
    return this.orderExpirationQueue?.getDeadLetterJobs() ?? [];
  }

  async retryDeadLetterJob(
    dlqJobId: string,
  ): Promise<OrderExpirationJobResult> {
    if (!this.orderExpirationQueue) {
      throw new NotFoundException('Order expiration queue is not available');
    }
    return this.orderExpirationQueue.retryDeadLetterJob(dlqJobId);
  }

  private async scheduleOrderExpiration(
    order: { id: string; userId: string; expiresAt?: Date },
    delayMs: number,
  ): Promise<void> {
    if (!this.orderExpirationQueue) {
      return;
    }

    await this.orderExpirationQueue.enqueueOrderExpiration(order.id, {
      userId: order.userId,
      expiresAt: order.expiresAt,
      delayMs,
    });
  }
}
