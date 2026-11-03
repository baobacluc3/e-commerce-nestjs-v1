import { randomUUID } from 'node:crypto';
import {
  OrderStatus,
  PaymentStatus,
  Role,
  StockMovementType,
} from '../src/generated/prisma/enums';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  price: number;
  stock: number;
  isActive: boolean;
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementRow {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  referenceId: string | null;
  userId: string | null;
  createdAt: Date;
}

export interface CartRow {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartItemRow {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderRow {
  id: string;
  userId: string;
  status: OrderStatus;
  totalPrice: number;
  idempotencyKey: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productSku: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  createdAt: Date;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string;
  clientSecret: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  lastWebhookEventId: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InMemoryDatabase {
  users = new Map<string, UserRow>();
  refreshTokens = new Map<string, RefreshTokenRow>();
  categories = new Map<string, CategoryRow>();
  products = new Map<string, ProductRow>();
  stockMovements = new Map<string, StockMovementRow>();
  carts = new Map<string, CartRow>();
  cartItems = new Map<string, CartItemRow>();
  orders = new Map<string, OrderRow>();
  orderItems = new Map<string, OrderItemRow>();
  payments = new Map<string, PaymentRow>();

  reset() {
    this.users.clear();
    this.refreshTokens.clear();
    this.categories.clear();
    this.products.clear();
    this.stockMovements.clear();
    this.carts.clear();
    this.cartItems.clear();
    this.orders.clear();
    this.orderItems.clear();
    this.payments.clear();
  }

  snapshot() {
    const cloneMap = <V extends object>(map: Map<string, V>) =>
      new Map<string, V>(
        Array.from(map.entries()).map(([k, v]) => [k, { ...v }]),
      );

    return {
      users: cloneMap(this.users),
      refreshTokens: cloneMap(this.refreshTokens),
      categories: cloneMap(this.categories),
      products: cloneMap(this.products),
      stockMovements: cloneMap(this.stockMovements),
      carts: cloneMap(this.carts),
      cartItems: cloneMap(this.cartItems),
      orders: cloneMap(this.orders),
      orderItems: cloneMap(this.orderItems),
      payments: cloneMap(this.payments),
    };
  }

  restore(snap: ReturnType<InMemoryDatabase['snapshot']>) {
    this.users = snap.users;
    this.refreshTokens = snap.refreshTokens;
    this.categories = snap.categories;
    this.products = snap.products;
    this.stockMovements = snap.stockMovements;
    this.carts = snap.carts;
    this.cartItems = snap.cartItems;
    this.orders = snap.orders;
    this.orderItems = snap.orderItems;
    this.payments = snap.payments;
  }
}

export class InMemoryPrismaService {
  constructor(public readonly db = new InMemoryDatabase()) {}

  async $connect() {
    return Promise.resolve();
  }

  async $disconnect() {
    return Promise.resolve();
  }

  async checkConnection() {
    return Promise.resolve();
  }

  async $transaction<T>(
    callback: (tx: InMemoryPrismaService) => Promise<T>,
  ): Promise<T> {
    const snap = this.db.snapshot();
    try {
      return await callback(this);
    } catch (error) {
      this.db.restore(snap);
      throw error;
    }
  }

  async $queryRaw<T = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> {
    const query = strings.join('?');

    // Pattern 1: Decrement stock
    if (
      query.includes('UPDATE products') &&
      query.includes('SET stock = stock -')
    ) {
      const quantity = Number(values[0]);
      const productId = String(values[1]);
      const product = this.db.products.get(productId);

      if (product && product.isActive && product.stock >= quantity) {
        product.stock -= quantity;
        product.updatedAt = new Date();
        return [
          {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            stock: product.stock,
            is_active: product.isActive,
          },
        ] as T;
      }
      return [] as T;
    }

    // Pattern 2: Restock
    if (
      query.includes('UPDATE products') &&
      query.includes('SET stock = stock +')
    ) {
      const quantity = Number(values[0]);
      const productId = String(values[1]);
      const product = this.db.products.get(productId);

      if (product) {
        product.stock += quantity;
        product.updatedAt = new Date();
        return [{ id: product.id, stock: product.stock }] as T;
      }
      return [] as T;
    }

    return [] as T;
  }

  user = {
    findUnique: async ({
      where,
    }: {
      where: { email?: string; id?: string };
    }) => {
      for (const user of this.db.users.values()) {
        if (where.email && user.email === where.email) return user;
        if (where.id && user.id === where.id) return user;
      }
      return null;
    },
    create: async ({
      data,
      select,
    }: {
      data: Partial<UserRow>;
      select?: Record<string, boolean>;
    }) => {
      const id = data.id ?? randomUUID();
      const user: UserRow = {
        id,
        email: data.email!,
        passwordHash: data.passwordHash!,
        name: data.name!,
        role: data.role ?? Role.CUSTOMER,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.users.set(id, user);

      if (select) {
        const filtered: Record<string, unknown> = {};
        for (const [key, enabled] of Object.entries(select)) {
          if (enabled)
            filtered[key] = (user as unknown as Record<string, unknown>)[key];
        }
        return filtered;
      }
      return user;
    },
    count: async ({ where }: { where?: { role?: Role } } = {}) => {
      let count = 0;
      for (const u of this.db.users.values()) {
        if (where?.role && u.role !== where.role) continue;
        count++;
      }
      return count;
    },
  };

  refreshToken = {
    create: async ({ data }: { data: Partial<RefreshTokenRow> }) => {
      const id = data.id ?? randomUUID();
      const row: RefreshTokenRow = {
        id,
        userId: data.userId!,
        familyId: data.familyId!,
        tokenHash: data.tokenHash!,
        expiresAt: data.expiresAt!,
        revokedAt: data.revokedAt ?? null,
        createdAt: new Date(),
      };
      this.db.refreshTokens.set(id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash?: string } }) => {
      for (const token of this.db.refreshTokens.values()) {
        if (where.tokenHash && token.tokenHash === where.tokenHash)
          return token;
      }
      return null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<RefreshTokenRow>;
    }) => {
      const row = this.db.refreshTokens.get(where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { familyId?: string; userId?: string };
      data: Partial<RefreshTokenRow>;
    }) => {
      let count = 0;
      for (const token of this.db.refreshTokens.values()) {
        if (where.familyId && token.familyId !== where.familyId) continue;
        if (where.userId && token.userId !== where.userId) continue;
        Object.assign(token, data);
        count++;
      }
      return { count };
    },
  };

  category = {
    upsert: async ({
      where,
      create,
    }: {
      where: { slug: string };
      update: Partial<CategoryRow>;
      create: Partial<CategoryRow>;
    }) => {
      for (const cat of this.db.categories.values()) {
        if (cat.slug === where.slug) return cat;
      }
      const id = create.id ?? randomUUID();
      const cat: CategoryRow = {
        id,
        name: create.name!,
        slug: create.slug!,
        description: create.description ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.categories.set(id, cat);
      return cat;
    },
  };

  product = {
    create: async ({ data }: { data: Partial<ProductRow> }) => {
      const id = data.id ?? randomUUID();
      const product: ProductRow = {
        id,
        name: data.name!,
        slug: data.slug!,
        sku: data.sku!,
        description: data.description ?? null,
        price: data.price!,
        stock: data.stock ?? 0,
        isActive: data.isActive ?? true,
        categoryId: data.categoryId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.products.set(id, product);
      return product;
    },
    findUnique: async ({
      where,
    }: {
      where: { id?: string; sku?: string; slug?: string };
      select?: Record<string, boolean>;
    }) => {
      for (const p of this.db.products.values()) {
        if (where.id && p.id === where.id) return p;
        if (where.sku && p.sku === where.sku) return p;
        if (where.slug && p.slug === where.slug) return p;
      }
      return null;
    },
    findMany: async ({
      where,
      skip,
      take,
    }: {
      where?: { stock?: { lte?: number; gt?: number }; isActive?: boolean };
      skip?: number;
      take?: number;
      orderBy?: unknown;
    } = {}) => {
      let list = Array.from(this.db.products.values());
      if (where?.isActive !== undefined) {
        list = list.filter((p) => p.isActive === where.isActive);
      }
      if (where?.stock?.lte !== undefined) {
        list = list.filter((p) => p.stock <= where.stock!.lte!);
      }
      if (where?.stock?.gt !== undefined) {
        list = list.filter((p) => p.stock > where.stock!.gt!);
      }
      const start = skip ?? 0;
      const end = take ? start + take : list.length;
      return list.slice(start, end);
    },
    count: async () => this.db.products.size,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<ProductRow>;
    }) => {
      const p = this.db.products.get(where.id);
      if (p) Object.assign(p, data, { updatedAt: new Date() });
      return p;
    },
  };

  stockMovement = {
    create: async ({ data }: { data: Partial<StockMovementRow> }) => {
      const id = data.id ?? randomUUID();
      const row: StockMovementRow = {
        id,
        productId: data.productId!,
        type: data.type!,
        quantity: data.quantity!,
        balanceAfter: data.balanceAfter!,
        reason: data.reason ?? null,
        referenceId: data.referenceId ?? null,
        userId: data.userId ?? null,
        createdAt: new Date(),
      };
      this.db.stockMovements.set(id, row);
      return row;
    },
    findMany: async () => Array.from(this.db.stockMovements.values()),
    count: async () => this.db.stockMovements.size,
  };

  cart = {
    upsert: async ({
      where,
      create,
      include,
    }: {
      where: { userId: string };
      update: unknown;
      create: { userId: string };
      include?: { items?: { include?: { product?: boolean } } };
      select?: unknown;
    }) => {
      let cart: CartRow | undefined;
      for (const c of this.db.carts.values()) {
        if (c.userId === where.userId) {
          cart = c;
          break;
        }
      }
      if (!cart) {
        const id = randomUUID();
        cart = {
          id,
          userId: create.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.db.carts.set(id, cart);
      }

      if (include?.items) {
        const items = Array.from(this.db.cartItems.values())
          .filter((ci) => ci.cartId === cart.id)
          .map((ci) => ({
            ...ci,
            product: this.db.products.get(ci.productId)!,
          }));
        return { ...cart, items };
      }
      return cart;
    },
    findUnique: async ({
      where,
      include,
    }: {
      where: { userId: string };
      include?: { items?: unknown };
    }) => {
      for (const cart of this.db.carts.values()) {
        if (cart.userId === where.userId) {
          if (include?.items) {
            const items = Array.from(this.db.cartItems.values())
              .filter((ci) => ci.cartId === cart.id)
              .map((ci) => ({
                ...ci,
                product: this.db.products.get(ci.productId)!,
              }));
            return { ...cart, items };
          }
          return cart;
        }
      }
      return null;
    },
  };

  cartItem = {
    findUnique: async ({
      where,
    }: {
      where: { cartId_productId: { cartId: string; productId: string } };
    }) => {
      for (const item of this.db.cartItems.values()) {
        if (
          item.cartId === where.cartId_productId.cartId &&
          item.productId === where.cartId_productId.productId
        ) {
          return item;
        }
      }
      return null;
    },
    findFirst: async ({
      where,
      include,
    }: {
      where: { id: string; cartId: string };
      include?: { product?: boolean };
    }) => {
      const item = this.db.cartItems.get(where.id);
      if (item && item.cartId === where.cartId) {
        if (include?.product) {
          return { ...item, product: this.db.products.get(item.productId)! };
        }
        return item;
      }
      return null;
    },
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { cartId_productId: { cartId: string; productId: string } };
      update: { quantity: number };
      create: { cartId: string; productId: string; quantity: number };
    }) => {
      for (const item of this.db.cartItems.values()) {
        if (
          item.cartId === where.cartId_productId.cartId &&
          item.productId === where.cartId_productId.productId
        ) {
          item.quantity = update.quantity;
          item.updatedAt = new Date();
          return item;
        }
      }
      const id = randomUUID();
      const newItem: CartItemRow = {
        id,
        cartId: create.cartId,
        productId: create.productId,
        quantity: create.quantity,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.cartItems.set(id, newItem);
      return newItem;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { quantity: number };
    }) => {
      const item = this.db.cartItems.get(where.id);
      if (item) {
        item.quantity = data.quantity;
        item.updatedAt = new Date();
      }
      return item;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const item = this.db.cartItems.get(where.id);
      if (item) this.db.cartItems.delete(where.id);
      return item;
    },
    deleteMany: async ({ where }: { where: { cartId: string } }) => {
      let count = 0;
      for (const [id, item] of this.db.cartItems.entries()) {
        if (item.cartId === where.cartId) {
          this.db.cartItems.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  order = {
    create: async ({
      data,
      include,
    }: {
      data: {
        userId: string;
        status: OrderStatus;
        totalPrice: number;
        idempotencyKey?: string | null;
        expiresAt: Date;
        items: {
          create: Array<Omit<OrderItemRow, 'id' | 'orderId' | 'createdAt'>>;
        };
      };
      include?: { items?: boolean };
    }) => {
      const id = randomUUID();
      const order: OrderRow = {
        id,
        userId: data.userId,
        status: data.status,
        totalPrice: data.totalPrice,
        idempotencyKey: data.idempotencyKey ?? null,
        expiresAt: data.expiresAt,
        paidAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.orders.set(id, order);

      const items: OrderItemRow[] = [];
      for (const itemData of data.items.create) {
        const itemId = randomUUID();
        const itemRow: OrderItemRow = {
          id: itemId,
          orderId: id,
          productId: itemData.productId,
          productName: itemData.productName,
          productSku: itemData.productSku,
          unitPrice: itemData.unitPrice,
          quantity: itemData.quantity,
          subtotal: itemData.subtotal,
          createdAt: new Date(),
        };
        this.db.orderItems.set(itemId, itemRow);
        items.push(itemRow);
      }

      if (include?.items) {
        return { ...order, items };
      }
      return order;
    },
    findUnique: async ({
      where,
      include,
    }: {
      where: {
        id?: string;
        userId_idempotencyKey?: { userId: string; idempotencyKey: string };
      };
      include?: { items?: boolean; user?: boolean; payments?: unknown };
    }) => {
      let order: OrderRow | undefined;
      for (const o of this.db.orders.values()) {
        if (where.id && o.id === where.id) {
          order = o;
          break;
        }
        if (
          where.userId_idempotencyKey &&
          o.userId === where.userId_idempotencyKey.userId &&
          o.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
        ) {
          order = o;
          break;
        }
      }
      if (!order) return null;

      const result: Record<string, unknown> = { ...order };
      if (include?.items) {
        result.items = Array.from(this.db.orderItems.values()).filter(
          (oi) => oi.orderId === order.id,
        );
      }
      if (include?.user) {
        result.user = this.db.users.get(order.userId);
      }
      if (include?.payments) {
        result.payments = Array.from(this.db.payments.values()).filter(
          (p) => p.orderId === order.id,
        );
      }
      return result;
    },
    findMany: async ({
      where,
      include,
    }: {
      where?: {
        userId?: string;
        status?: OrderStatus;
        expiresAt?: { lte?: Date };
      };
      include?: { items?: boolean; user?: boolean };
      skip?: number;
      take?: number;
      orderBy?: unknown;
    } = {}) => {
      let list = Array.from(this.db.orders.values());
      if (where?.userId) list = list.filter((o) => o.userId === where.userId);
      if (where?.status) list = list.filter((o) => o.status === where.status);
      if (where?.expiresAt?.lte) {
        const lte = where.expiresAt.lte;
        list = list.filter((o) => o.expiresAt.getTime() <= lte.getTime());
      }

      return list.map((order) => {
        const item: Record<string, unknown> = { ...order };
        if (include?.items) {
          item.items = Array.from(this.db.orderItems.values()).filter(
            (oi) => oi.orderId === order.id,
          );
        }
        if (include?.user) {
          item.user = this.db.users.get(order.userId);
        }
        return item;
      });
    },
    count: async () => this.db.orders.size,
    update: async ({
      where,
      data,
      include,
    }: {
      where: { id: string };
      data: Partial<OrderRow>;
      include?: { items?: boolean };
    }) => {
      const order = this.db.orders.get(where.id);
      if (order) {
        Object.assign(order, data, { updatedAt: new Date() });
      }
      if (include?.items) {
        const items = Array.from(this.db.orderItems.values()).filter(
          (oi) => oi.orderId === where.id,
        );
        return { ...order, items };
      }
      return order;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status?: OrderStatus | { in?: OrderStatus[] } };
      data: Partial<OrderRow>;
    }) => {
      let count = 0;
      for (const order of this.db.orders.values()) {
        if (where.id && order.id !== where.id) continue;
        if (typeof where.status === 'string' && order.status !== where.status)
          continue;
        if (
          typeof where.status === 'object' &&
          where.status.in &&
          !where.status.in.includes(order.status)
        ) {
          continue;
        }
        Object.assign(order, data, { updatedAt: new Date() });
        count++;
      }
      return { count };
    },
    aggregate: async () => {
      let total = 0;
      for (const o of this.db.orders.values()) {
        if (['PAID', 'SHIPPED', 'COMPLETED'].includes(o.status)) {
          total += o.totalPrice;
        }
      }
      return { _sum: { totalPrice: total } };
    },
    groupBy: async () => {
      const counts: Record<string, number> = {};
      for (const o of this.db.orders.values()) {
        counts[o.status] = (counts[o.status] || 0) + 1;
      }
      return Object.entries(counts).map(([status, count]) => ({
        status,
        _count: { id: count },
      }));
    },
  };

  orderItem = {
    findMany: async () => Array.from(this.db.orderItems.values()),
  };

  payment = {
    create: async ({ data }: { data: Partial<PaymentRow> }) => {
      const id = data.id ?? randomUUID();
      const row: PaymentRow = {
        id,
        orderId: data.orderId!,
        provider: data.provider ?? 'stripe',
        providerPaymentId: data.providerPaymentId!,
        clientSecret: data.clientSecret ?? null,
        amount: data.amount!,
        currency: data.currency ?? 'usd',
        status: data.status ?? PaymentStatus.PENDING,
        lastWebhookEventId: data.lastWebhookEventId ?? null,
        failureMessage: data.failureMessage ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.payments.set(id, row);
      return row;
    },
    findFirst: async ({
      where,
    }: {
      where: { orderId: string; status?: PaymentStatus };
      orderBy?: unknown;
    }) => {
      for (const p of this.db.payments.values()) {
        if (p.orderId === where.orderId) {
          if (!where.status || p.status === where.status) return p;
        }
      }
      return null;
    },
    findUnique: async ({
      where,
    }: {
      where: { providerPaymentId?: string; lastWebhookEventId?: string };
    }) => {
      for (const p of this.db.payments.values()) {
        if (
          where.providerPaymentId &&
          p.providerPaymentId === where.providerPaymentId
        ) {
          return p;
        }
        if (
          where.lastWebhookEventId &&
          p.lastWebhookEventId === where.lastWebhookEventId
        ) {
          return p;
        }
      }
      return null;
    },
    findMany: async ({
      where,
    }: {
      where: { orderId: string };
      orderBy?: unknown;
    }) => {
      return Array.from(this.db.payments.values()).filter(
        (p) => p.orderId === where.orderId,
      );
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<PaymentRow>;
    }) => {
      const p = this.db.payments.get(where.id);
      if (p) Object.assign(p, data, { updatedAt: new Date() });
      return p;
    },
  };
}
