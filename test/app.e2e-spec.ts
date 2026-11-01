import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  OrderStatus,
  PaymentStatus,
  Role,
} from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryDatabase, InMemoryPrismaService } from './in-memory-prisma';

describe('Phase 10: Happy-Path E2E Journey', () => {
  let app: INestApplication;
  let inMemoryDb: InMemoryDatabase;
  let inMemoryPrisma: InMemoryPrismaService;

  const testWebhookSecret = 'whsec_test_local_placeholder';
  let adminAccessToken: string;
  let productId: string;
  const initialStock = 10;
  const itemPrice = 10000; // $100.00 (in cents)

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

    // Seed default Admin user into inMemoryDb
    const adminPasswordHash = await argon2.hash('AdminPassword123!', {
      type: argon2.argon2id,
    });
    await inMemoryPrisma.user.create({
      data: {
        email: 'admin@example.com',
        passwordHash: adminPasswordHash,
        name: 'Super Admin',
        role: Role.ADMIN,
      },
    });

    // Login as Admin to get admin access token
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'AdminPassword123!',
      })
      .expect(200);

    adminAccessToken = adminLoginRes.body.accessToken;

    // Seed a product with initialStock = 10
    const product = await inMemoryPrisma.product.create({
      data: {
        name: 'Ergonomic Mechanical Keyboard',
        slug: 'ergonomic-mechanical-keyboard',
        sku: 'KB-ERG-100',
        price: itemPrice,
        stock: initialStock,
        isActive: true,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs complete happy-path journey asserting DB state at every step', async () => {
    // -------------------------------------------------------------
    // 1. REGISTER
    // -------------------------------------------------------------
    const customerEmail = 'happy.customer@example.com';
    const customerPassword = 'CustomerPassword123!';

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: customerEmail,
        password: customerPassword,
        name: 'Happy Shopper',
      })
      .expect(201);

    expect(registerRes.body.email).toBe(customerEmail);
    expect(registerRes.body.name).toBe('Happy Shopper');
    expect(registerRes.body.role).toBe(Role.CUSTOMER);
    expect(registerRes.body.passwordHash).toBeUndefined();

    // Assert DB State: customer exists, role is CUSTOMER, password is argon2 hashed
    const customerInDb = await inMemoryPrisma.user.findUnique({
      where: { email: customerEmail },
    });
    expect(customerInDb).toBeDefined();
    expect(customerInDb!.role).toBe(Role.CUSTOMER);
    expect(customerInDb!.passwordHash).toMatch(/^\$argon2id\$/);

    // -------------------------------------------------------------
    // 2. LOGIN
    // -------------------------------------------------------------
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: customerEmail,
        password: customerPassword,
      })
      .expect(200);

    const customerAccessToken = loginRes.body.accessToken;
    expect(customerAccessToken).toBeDefined();
    expect(loginRes.body.refreshToken).toBeDefined();

    // Assert DB State: exactly 1 refresh token row stored in DB
    const refreshTokens = Array.from(inMemoryDb.refreshTokens.values()).filter(
      (rt) => rt.userId === customerInDb!.id,
    );
    expect(refreshTokens).toHaveLength(1);
    expect(refreshTokens[0].tokenHash).toHaveLength(64); // SHA-256

    // -------------------------------------------------------------
    // 3. ADD TO CART
    // -------------------------------------------------------------
    const orderQuantity = 2;

    const addToCartRes = await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .send({
        productId,
        quantity: orderQuantity,
      })
      .expect(201);

    expect(addToCartRes.body.items).toHaveLength(1);
    expect(addToCartRes.body.items[0].quantity).toBe(orderQuantity);
    expect(addToCartRes.body.totalPrice).toBe(itemPrice * orderQuantity);
    expect(addToCartRes.body.isCheckoutReady).toBe(true);

    // Assert DB State: Cart and CartItem exist, product stock has NOT yet changed
    const userCart = Array.from(inMemoryDb.carts.values()).find(
      (c) => c.userId === customerInDb!.id,
    );
    expect(userCart).toBeDefined();
    const cartItems = Array.from(inMemoryDb.cartItems.values()).filter(
      (ci) => ci.cartId === userCart!.id,
    );
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].quantity).toBe(orderQuantity);

    const productBeforeCheckout = inMemoryDb.products.get(productId);
    expect(productBeforeCheckout!.stock).toBe(initialStock); // Still 10

    // -------------------------------------------------------------
    // 4. CHECKOUT
    // -------------------------------------------------------------
    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .set('Idempotency-Key', 'idem_journey_test_001')
      .expect(201);

    const orderId = checkoutRes.body.id;
    expect(orderId).toBeDefined();
    expect(checkoutRes.body.status).toBe(OrderStatus.PENDING);
    expect(checkoutRes.body.totalPrice).toBe(itemPrice * orderQuantity);
    expect(checkoutRes.body.items).toHaveLength(1);
    expect(checkoutRes.body.items[0].unitPrice).toBe(itemPrice);

    // 🔍 ASSERT STATE AFTER CHECKOUT:
    // a) Product stock decreased by orderQuantity
    const productAfterCheckout = inMemoryDb.products.get(productId);
    expect(productAfterCheckout!.stock).toBe(initialStock - orderQuantity); // 10 - 2 = 8

    // b) Cart is completely empty in the database
    const cartItemsAfterCheckout = Array.from(
      inMemoryDb.cartItems.values(),
    ).filter((ci) => ci.cartId === userCart!.id);
    expect(cartItemsAfterCheckout).toHaveLength(0);

    // c) Order status is PENDING
    const orderInDb = inMemoryDb.orders.get(orderId);
    expect(orderInDb).toBeDefined();
    expect(orderInDb!.status).toBe(OrderStatus.PENDING);
    expect(orderInDb!.totalPrice).toBe(itemPrice * orderQuantity);

    // d) StockMovement was logged with type OUT
    const movements = Array.from(inMemoryDb.stockMovements.values()).filter(
      (m) => m.referenceId === orderId,
    );
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('OUT');
    expect(movements[0].quantity).toBe(orderQuantity);
    expect(movements[0].balanceAfter).toBe(8);

    // e) No payments completed yet
    const paymentsBeforeIntent = Array.from(
      inMemoryDb.payments.values(),
    ).filter((p) => p.orderId === orderId);
    expect(paymentsBeforeIntent).toHaveLength(0);

    // -------------------------------------------------------------
    // 5. SIGNED STRIPE WEBHOOK (payment_intent.succeeded)
    // -------------------------------------------------------------
    // Create payment intent first
    const intentRes = await request(app.getHttpServer())
      .post(`/api/v1/payments/orders/${orderId}/intent`)
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .expect(201);

    const providerPaymentId = intentRes.body.providerPaymentId;
    expect(providerPaymentId).toBeDefined();

    // Prepare signed webhook payload
    const webhookPayloadObj = {
      id: 'evt_stripe_happy_001',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: providerPaymentId,
          object: 'payment_intent',
          amount: itemPrice * orderQuantity,
          metadata: { orderId, userId: customerInDb!.id },
        },
      },
    };
    const webhookPayloadString = JSON.stringify(webhookPayloadObj);
    const webhookSignature = Stripe.webhooks.generateTestHeaderString({
      payload: webhookPayloadString,
      secret: testWebhookSecret,
    });

    const webhookRes = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', webhookSignature)
      .send(webhookPayloadString)
      .expect(200);

    expect(webhookRes.body.received).toBe(true);
    expect(webhookRes.body.duplicate).toBe(false);

    // 🔍 ASSERT STATE AFTER SIGNED WEBHOOK:
    // a) Order status is now PAID in database
    const orderAfterWebhook = inMemoryDb.orders.get(orderId);
    expect(orderAfterWebhook!.status).toBe(OrderStatus.PAID);
    expect(orderAfterWebhook!.paidAt).toBeInstanceOf(Date);

    // b) Exactly ONE Payment row in the database, with status SUCCEEDED
    const paymentsAfterWebhook = Array.from(
      inMemoryDb.payments.values(),
    ).filter((p) => p.orderId === orderId);
    expect(paymentsAfterWebhook).toHaveLength(1);
    expect(paymentsAfterWebhook[0].status).toBe(PaymentStatus.SUCCEEDED);
    expect(paymentsAfterWebhook[0].providerPaymentId).toBe(providerPaymentId);
    expect(paymentsAfterWebhook[0].lastWebhookEventId).toBe(
      'evt_stripe_happy_001',
    );

    // -------------------------------------------------------------
    // 6. REPLAY THE WEBHOOK ONCE
    // -------------------------------------------------------------
    const replayRes = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', webhookSignature)
      .send(webhookPayloadString)
      .expect(200);

    expect(replayRes.body.received).toBe(true);
    expect(replayRes.body.duplicate).toBe(true);

    // 🔍 ASSERT STATE AFTER REPLAY:
    // Still exactly ONE Payment row in the database!
    const paymentsAfterReplay = Array.from(inMemoryDb.payments.values()).filter(
      (p) => p.orderId === orderId,
    );
    expect(paymentsAfterReplay).toHaveLength(1);
    expect(paymentsAfterReplay[0].status).toBe(PaymentStatus.SUCCEEDED);

    // Order status is still PAID
    const orderAfterReplay = inMemoryDb.orders.get(orderId);
    expect(orderAfterReplay!.status).toBe(OrderStatus.PAID);

    // -------------------------------------------------------------
    // 7. ADMIN SHIPS ORDER
    // -------------------------------------------------------------
    const shipRes = await request(app.getHttpServer())
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        status: OrderStatus.SHIPPED,
      })
      .expect(200);

    expect(shipRes.body.status).toBe(OrderStatus.SHIPPED);

    // 🔍 ASSERT STATE AFTER ADMIN SHIPS:
    // Order status is now SHIPPED in database
    const orderAfterShip = inMemoryDb.orders.get(orderId);
    expect(orderAfterShip!.status).toBe(OrderStatus.SHIPPED);

    // -------------------------------------------------------------
    // 8. CUSTOMER SEES SHIPPED
    // -------------------------------------------------------------
    const customerViewRes = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccessToken}`)
      .expect(200);

    expect(customerViewRes.body.id).toBe(orderId);
    expect(customerViewRes.body.status).toBe(OrderStatus.SHIPPED);
    expect(customerViewRes.body.totalPrice).toBe(itemPrice * orderQuantity);
    expect(customerViewRes.body.items).toHaveLength(1);
    expect(customerViewRes.body.items[0].productName).toBe(
      'Ergonomic Mechanical Keyboard',
    );
    expect(customerViewRes.body.items[0].quantity).toBe(orderQuantity);
    expect(customerViewRes.body.items[0].subtotal).toBe(
      itemPrice * orderQuantity,
    );
  });
});
