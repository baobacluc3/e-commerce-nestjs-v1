import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OrderStatus, Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryDatabase, InMemoryPrismaService } from './in-memory-prisma';

describe('Phase 9: Security Hardening & OWASP Regression Suite', () => {
  let app: INestApplication;
  let inMemoryDb: InMemoryDatabase;
  let inMemoryPrisma: InMemoryPrismaService;

  let customerAToken: string;
  let customerAId: string;
  let customerBToken: string;
  let adminToken: string;

  let testProductId: string;
  let userAOrderId: string;

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

    // 1. Seed Admin user
    const passwordHash = await argon2.hash('SecretAdminPass123!', {
      type: argon2.argon2id,
    });
    await inMemoryPrisma.user.create({
      data: {
        email: 'security.admin@example.com',
        passwordHash,
        name: 'Sec Admin',
        role: Role.ADMIN,
      },
    });

    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'security.admin@example.com',
        password: 'SecretAdminPass123!',
      })
      .expect(200);
    adminToken = adminLoginRes.body.accessToken as string;

    // 2. Register Customer A
    const custARes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'victim.user@example.com',
        password: 'UserPassword123!',
        name: 'Victim User',
      })
      .expect(201);
    customerAId = custARes.body.id as string;

    const custALogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'victim.user@example.com',
        password: 'UserPassword123!',
      })
      .expect(200);
    customerAToken = custALogin.body.accessToken as string;

    // 3. Register Customer B (Attacker / Other Customer)
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'attacker.user@example.com',
        password: 'UserPassword123!',
        name: 'Attacker User',
      })
      .expect(201);

    const custBLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'attacker.user@example.com',
        password: 'UserPassword123!',
      })
      .expect(200);
    customerBToken = custBLogin.body.accessToken as string;

    // 4. Create a test product
    const product = await inMemoryPrisma.product.create({
      data: {
        name: 'Secure Laptop Stand',
        slug: 'secure-laptop-stand',
        sku: 'SEC-LAP-01',
        price: 5000,
        stock: 20,
        isActive: true,
      },
    });
    testProductId = product.id;

    // 5. Customer A creates an order
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ productId: testProductId, quantity: 1 })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', 'sec-checkout-idem-001')
      .expect(201);
    userAOrderId = checkoutRes.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('OWASP API1:2023 - Broken Object Level Authorization (BOLA / IDOR)', () => {
    it('rejects Customer B attempting to view Customer A order with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${userAOrderId}`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.message).toContain(
        'Forbidden: you do not have permission to view this order',
      );
    });

    it('rejects Customer B attempting to cancel Customer A order with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${userAOrderId}/cancel`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ reason: 'Malicious cancellation attempt' })
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.message).toContain(
        'Forbidden: you do not have permission to cancel this order',
      );

      // Verify order is still PENDING in DB
      const order = inMemoryDb.orders.get(userAOrderId);
      expect(order!.status).toBe(OrderStatus.PENDING);
    });

    it('rejects Customer B attempting to create payment intent for Customer A order with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/payments/orders/${userAOrderId}/intent`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.message).toContain(
        'Forbidden: you do not have permission to pay for this order',
      );
    });

    it('allows Admin to view any customer order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/orders/${userAOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(userAOrderId);
      expect(res.body.userId).toBe(customerAId);
    });
  });

  describe('OWASP API2:2023 - Authentication & 401 Unauthorized Enforcement', () => {
    it('rejects unauthenticated request to /users/me with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });

    it('rejects unauthenticated request to /cart with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/cart').expect(401);
    });

    it('rejects unauthenticated request to /orders/checkout with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .expect(401);
    });

    it('rejects unauthenticated request to /admin/metrics with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/metrics')
        .expect(401);
    });

    it('rejects forged/garbage Bearer token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid.token.payload')
        .expect(401);
    });

    it('rejects invalid refresh token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'totally-invalid-refresh-token' })
        .expect(401);
    });
  });

  describe('OWASP API3:2023 - Broken Object Property Level Authorization (Mass Assignment)', () => {
    it('rejects registration with role property injected (privilege escalation attempt)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'hacker@example.com',
          password: 'Password123!',
          name: 'Hacker',
          role: 'ADMIN', // Unauthorized property injection
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(
        res.body.message.some((msg: string) =>
          msg.includes('property role should not exist'),
        ),
      ).toBe(true);

      // Verify user was NOT created in DB
      const hackerUser = await inMemoryPrisma.user.findUnique({
        where: { email: 'hacker@example.com' },
      });
      expect(hackerUser).toBeNull();
    });

    it('rejects checkout with injected status or totalPrice property', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          status: 'PAID', // Attempt to mark unpaid order as paid
          totalPrice: 0, // Attempt to set price to $0
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(
        res.body.message.some((msg: string) =>
          msg.includes('should not exist'),
        ),
      ).toBe(true);
    });
  });

  describe('OWASP API5:2023 - Broken Function Level Authorization (BFLA)', () => {
    it('blocks Customer token from GET /admin/metrics with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${customerAToken}`)
        .expect(403);
    });

    it('blocks Customer token from GET /admin/orders with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/orders')
        .set('Authorization', `Bearer ${customerAToken}`)
        .expect(403);
    });

    it('blocks Customer token from PATCH /admin/orders/:id/status with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/orders/${userAOrderId}/status`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ status: OrderStatus.SHIPPED })
        .expect(403);
    });

    it('blocks Customer token from POST /admin/inventory/adjust with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/inventory/adjust')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: testProductId,
          newStock: 9999,
          reason: 'Unauthorized stock manipulation',
        })
        .expect(403);
    });

    it('blocks Customer token from POST /products (catalog write) with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          name: 'Fake Product',
          slug: 'fake-product',
          sku: 'FAKE-01',
          price: 100,
          stock: 10,
        })
        .expect(403);
    });

    it('blocks Customer token from PATCH /products/:id with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${testProductId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ price: 1 })
        .expect(403);
    });

    it('blocks Customer token from DELETE /products/:id with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/products/${testProductId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .expect(403);
    });
  });

  describe('OWASP API10:2023 - Unsafe API Consumption & Webhook Forgery', () => {
    it('rejects Stripe webhook without stripe-signature header with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .send({ type: 'payment_intent.succeeded' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('Missing Stripe-Signature header');
    });

    it('rejects Stripe webhook with forged signature with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 't=1234567890,v1=forged_invalid_hmac_hex')
        .send({ type: 'payment_intent.succeeded' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid webhook signature');
    });
  });
});
