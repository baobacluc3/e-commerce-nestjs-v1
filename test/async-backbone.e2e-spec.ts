import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  OrderStatus,
  Role,
  StockMovementType,
} from '../src/generated/prisma/enums';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  OrderExpirationQueueService,
  WorkerTerminatedError,
} from '../src/queues/order-expiration.queue';
import { DEFAULT_ORDER_EXPIRY_DELAY_MS } from '../src/queues/queue.constants';
import { InMemoryDatabase, InMemoryPrismaService } from './in-memory-prisma';

describe('Phase 13: Async Backbone E2E (BullMQ, 30m Expiry, Retries, DLQ, Idempotency, Crash Recovery, Graceful Shutdown)', () => {
  let app: INestApplication;
  let inMemoryDb: InMemoryDatabase;
  let inMemoryPrisma: InMemoryPrismaService;
  let queueService: OrderExpirationQueueService;
  let ordersService: OrdersService;

  let adminToken: string;
  let customerToken: string;
  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    inMemoryDb = new InMemoryDatabase();
    inMemoryPrisma = new InMemoryPrismaService(inMemoryDb);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(inMemoryPrisma)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    queueService = app.get(OrderExpirationQueueService);
    ordersService = app.get(OrdersService);

    // Seed Admin
    const adminHash = await argon2.hash('AdminPassword123!', {
      type: argon2.argon2id,
    });
    await inMemoryPrisma.user.create({
      data: {
        email: 'admin.async@example.com',
        passwordHash: adminHash,
        name: 'Async Admin',
        role: Role.ADMIN,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin.async@example.com',
        password: 'AdminPassword123!',
      })
      .expect(200);
    adminToken = adminLogin.body.accessToken as string;

    // Register & login Customer
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'customer.async@example.com',
        password: 'CustomerPassword123!',
        name: 'Async Customer',
      })
      .expect(201);

    const customerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'customer.async@example.com',
        password: 'CustomerPassword123!',
      })
      .expect(200);
    customerToken = customerLogin.body.accessToken as string;
  });

  beforeEach(async () => {
    // Re-register standard processor before each test
    queueService.clearTrackedJobs();
    queueService.registerProcessor((data) =>
      ordersService.expireOrder(data.orderId),
    );

    // Create fresh products for each test
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prodA = await inMemoryPrisma.product.create({
      data: {
        name: `Async Keyboard ${suffix}`,
        slug: `async-keyboard-${suffix}`,
        sku: `ASYNC-KB-${suffix}`,
        price: 10000,
        stock: 10,
        isActive: true,
      },
    });
    const prodB = await inMemoryPrisma.product.create({
      data: {
        name: `Async Mouse ${suffix}`,
        slug: `async-mouse-${suffix}`,
        sku: `ASYNC-MS-${suffix}`,
        price: 5000,
        stock: 10,
        isActive: true,
      },
    });
    productAId = prodA.id;
    productBId = prodB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Enqueues a 30-minute delayed BullMQ job at checkout and auto-cancels unpaid order with full restock', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: productAId, quantity: 3 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'idem-async-30m-1')
      .expect(201);

    const orderId = checkoutRes.body.id as string;
    expect(checkoutRes.body.status).toBe(OrderStatus.PENDING);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(7); // 10 - 3

    // Verify delayed job was enqueued with 30-min delay and exponential backoff config
    const scheduledJob = queueService.getJob(orderId);
    expect(scheduledJob).toBeDefined();
    expect(scheduledJob!.id).toBe(`expire-order-${orderId}`);
    expect(scheduledJob!.delay).toBe(DEFAULT_ORDER_EXPIRY_DELAY_MS); // 30 minutes (1,800,000 ms)
    expect(scheduledJob!.state).toBe('delayed');
    expect(scheduledJob!.maxAttempts).toBe(3);
    expect(scheduledJob!.backoffDelayMs).toBe(1000);

    // Execute the 30-minute expiration job
    const jobResult = await queueService.processOrderExpirationJob(orderId);

    expect(jobResult).toEqual({
      orderId,
      cancelled: true,
      status: OrderStatus.CANCELLED,
      restockedItemsCount: 1,
      idempotentSkip: false,
    });

    // Verify order is CANCELLED and product stock is restored to 10
    const orderInDb = inMemoryDb.orders.get(orderId)!;
    expect(orderInDb.status).toBe(OrderStatus.CANCELLED);
    expect(orderInDb.cancelledAt).toBeInstanceOf(Date);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(10);

    // Verify IN stock movement audit log was created
    const restockMovements = Array.from(
      inMemoryDb.stockMovements.values(),
    ).filter(
      (m) => m.referenceId === orderId && m.type === StockMovementType.IN,
    );
    expect(restockMovements).toHaveLength(1);
    expect(restockMovements[0].quantity).toBe(3);
    expect(restockMovements[0].balanceAfter).toBe(10);
    expect(restockMovements[0].reason).toBe('Order expired (unpaid)');
  });

  it('2. Running the same job twice (or 5 times) changes nothing (strict idempotency)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: productAId, quantity: 4 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    const orderId = checkoutRes.body.id as string;
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(6); // 10 - 4

    // First job execution cancels order and restocks 4 units (6 -> 10)
    const firstRun = await queueService.processOrderExpirationJob(orderId);
    expect(firstRun.cancelled).toBe(true);
    expect(firstRun.idempotentSkip).toBe(false);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(10);

    const cancelledAtAfterFirstRun =
      inMemoryDb.orders.get(orderId)!.cancelledAt;

    // Run the exact same job a 2nd, 3rd, and 4th time
    const secondRun = await queueService.processOrderExpirationJob(orderId);
    const thirdRun = await queueService.processOrderExpirationJob(orderId);
    const fourthRun = await ordersService.expireOrder(orderId);

    expect(secondRun).toEqual({
      orderId,
      cancelled: false,
      status: OrderStatus.CANCELLED,
      restockedItemsCount: 0,
      idempotentSkip: true,
    });
    expect(thirdRun.idempotentSkip).toBe(true);
    expect(fourthRun.idempotentSkip).toBe(true);

    // Stock is STILL 10 (never double-restocked), cancelledAt is unchanged, and only 1 IN movement exists
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(10);
    expect(inMemoryDb.orders.get(orderId)!.cancelledAt).toEqual(
      cancelledAtAfterFirstRun,
    );

    const restockMovements = Array.from(
      inMemoryDb.stockMovements.values(),
    ).filter(
      (m) => m.referenceId === orderId && m.type === StockMovementType.IN,
    );
    expect(restockMovements).toHaveLength(1);
  });

  it('3. Killing the worker mid-job loses nothing (atomic DB rollback + stalled job re-delivery)', async () => {
    // Checkout with 2 distinct products (Product A: qty 2, Product B: qty 3)
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: productAId, quantity: 2 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: productBId, quantity: 3 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    const orderId = checkoutRes.body.id as string;
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(8);
    expect(inMemoryDb.products.get(productBId)!.stock).toBe(7);

    // Simulate worker being killed mid-transaction right after restocking the 1st product
    // (before the 2nd product is restocked and before the DB transaction commits)
    let crashMidTransaction = true;
    const originalQueryRaw = inMemoryPrisma.$queryRaw.bind(inMemoryPrisma);
    let restockQueryCalls = 0;

    jest
      .spyOn(inMemoryPrisma, '$queryRaw')
      .mockImplementation(async (strings, ...values) => {
        const query = strings.join('?');
        if (
          crashMidTransaction &&
          query.includes('UPDATE products') &&
          query.includes('SET stock = stock +')
        ) {
          restockQueryCalls += 1;
          if (restockQueryCalls === 1) {
            // 1st product restocked in uncommitted transaction
            return originalQueryRaw(strings, ...values);
          }
          // Worker dies abruptly before 2nd product restock completes!
          throw new WorkerTerminatedError(
            'Worker killed with SIGKILL mid-job after partial restock',
          );
        }
        return originalQueryRaw(strings, ...values);
      });

    await expect(
      queueService.processOrderExpirationJob(orderId),
    ).rejects.toThrow(WorkerTerminatedError);

    // ASSERT 1: Database rolled back completely!
    // Order is still PENDING, Product A is still 8 (not 10!), Product B is still 7, and 0 IN movements exist
    expect(inMemoryDb.orders.get(orderId)!.status).toBe(OrderStatus.PENDING);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(8);
    expect(inMemoryDb.products.get(productBId)!.stock).toBe(7);
    const movementsAfterCrash = Array.from(
      inMemoryDb.stockMovements.values(),
    ).filter(
      (m) => m.referenceId === orderId && m.type === StockMovementType.IN,
    );
    expect(movementsAfterCrash).toHaveLength(0);

    // ASSERT 2: Job was NOT lost in the queue — it remains 'active' (stalled)
    const stalledJob = queueService.getJob(orderId)!;
    expect(stalledJob.state).toBe('active');

    // ASSERT 3: Surviving/restarted worker recovers the stalled job and completes it cleanly
    crashMidTransaction = false;
    jest.restoreAllMocks();

    const recovered = await queueService.recoverStalledJobs();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toEqual({
      orderId,
      cancelled: true,
      status: OrderStatus.CANCELLED,
      restockedItemsCount: 2,
      idempotentSkip: false,
    });

    // Order is now CANCELLED and BOTH products are fully restocked to 10!
    expect(inMemoryDb.orders.get(orderId)!.status).toBe(OrderStatus.CANCELLED);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(10);
    expect(inMemoryDb.products.get(productBId)!.stock).toBe(10);

    const movementsAfterRecovery = Array.from(
      inMemoryDb.stockMovements.values(),
    ).filter(
      (m) => m.referenceId === orderId && m.type === StockMovementType.IN,
    );
    expect(movementsAfterRecovery).toHaveLength(2);
  });

  it('4. Retries with exponential backoff, moves permanently failing jobs to DLQ, and replays from DLQ via Admin endpoint', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: productAId, quantity: 1 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    const orderId = checkoutRes.body.id as string;

    // Simulate persistent database outage across all 3 attempts
    queueService.registerProcessor(async () => {
      throw new Error('Connection terminated unexpectedly');
    });

    await expect(
      queueService.processOrderExpirationJob(orderId),
    ).rejects.toThrow('Connection terminated unexpectedly');

    const failedJob = queueService.getJob(orderId)!;
    expect(failedJob.state).toBe('failed');
    expect(failedJob.attemptsMade).toBe(3);
    expect(failedJob.backoffHistoryMs).toEqual([1000, 2000]);

    // Admin inspects Dead-Letter Queue via HTTP endpoint
    const dlqListRes = await request(app.getHttpServer())
      .get('/api/v1/orders/queues/dlq')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(dlqListRes.body).toHaveLength(1);
    const dlqEntry = dlqListRes.body[0];
    expect(dlqEntry.originalJobId).toBe(`expire-order-${orderId}`);
    expect(dlqEntry.failedReason).toBe('Connection terminated unexpectedly');
    expect(dlqEntry.attemptsMade).toBe(3);

    // Restore healthy processor and replay the DLQ job via Admin HTTP endpoint
    queueService.registerProcessor((data) =>
      ordersService.expireOrder(data.orderId),
    );

    const retryRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/queues/dlq/${dlqEntry.dlqJobId}/retry`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(retryRes.body).toEqual({
      orderId,
      cancelled: true,
      status: OrderStatus.CANCELLED,
      restockedItemsCount: 1,
      idempotentSkip: false,
    });

    // Order is now CANCELLED, stock is back to 10, and DLQ is empty
    expect(inMemoryDb.orders.get(orderId)!.status).toBe(OrderStatus.CANCELLED);
    expect(inMemoryDb.products.get(productAId)!.stock).toBe(10);
    expect(queueService.getDeadLetterJobs()).toHaveLength(0);
  });
});
