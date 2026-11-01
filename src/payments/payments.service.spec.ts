import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import { AppConfigService } from '../config/app-config.service';
import { OrderStatus, PaymentStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from './payment-provider.interface';
import { PaymentsService } from './payments.service';
import { StripePaymentProvider } from './stripe-payment.provider';

describe('PaymentsService & StripePaymentProvider', () => {
  let service: PaymentsService;
  let stripeProvider: StripePaymentProvider;
  let prisma: {
    $transaction: jest.Mock;
    order: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    payment: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const testWebhookSecret = 'whsec_test_secret_for_unit_tests_12345';
  const userA = { userId: 'user-a', role: Role.CUSTOMER };
  const userB = { userId: 'user-b', role: Role.CUSTOMER };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(
        <T>(callback: (tx: typeof prisma) => Promise<T>): Promise<T> =>
          callback(prisma),
      ),
      order: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      payment: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    stripeProvider = new StripePaymentProvider({
      stripeSecretKey: 'sk_test_local_placeholder',
      stripeWebhookSecret: testWebhookSecret,
    } as AppConfigService);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: PAYMENT_PROVIDER,
          useValue: stripeProvider as PaymentProvider,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  const createSignedWebhookRequest = (payloadObj: Record<string, unknown>) => {
    const payloadString = JSON.stringify(payloadObj);
    const rawBody = Buffer.from(payloadString, 'utf8');
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: payloadString,
      secret: testWebhookSecret,
    });
    return { rawBody, signature };
  };

  describe('createPaymentIntent', () => {
    it('creates a new PENDING payment intent for a valid PENDING order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 12999,
        expiresAt: new Date(Date.now() + 600000),
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'pay-1',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
      );

      const result = await service.createPaymentIntent('ord-1', userA);

      expect(result.orderId).toBe('ord-1');
      expect(result.amount).toBe(12999);
      expect(result.currency).toBe('usd');
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.provider).toBe('stripe');
      expect(result.providerPaymentId).toMatch(/^pi_test_/);
      expect(result.clientSecret).toContain('_secret_');
    });

    it('reuses an existing PENDING payment intent if one already exists for the order', async () => {
      const existingPayment = {
        id: 'pay-existing',
        orderId: 'ord-1',
        provider: 'stripe',
        providerPaymentId: 'pi_test_existing',
        clientSecret: 'pi_test_existing_secret_123',
        amount: 5000,
        currency: 'usd',
        status: PaymentStatus.PENDING,
      };

      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 5000,
        expiresAt: new Date(Date.now() + 600000),
      });
      prisma.payment.findFirst.mockResolvedValue(existingPayment);

      const result = await service.createPaymentIntent('ord-1', userA);

      expect(result).toEqual(existingPayment);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('forbids another user from creating a payment intent for someone else order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 5000,
        expiresAt: new Date(Date.now() + 600000),
      });

      await expect(service.createPaymentIntent('ord-1', userB)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects payment intent creation when order is already PAID or expired', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-paid',
        userId: userA.userId,
        status: OrderStatus.PAID,
        totalPrice: 5000,
        expiresAt: new Date(Date.now() + 600000),
      });

      await expect(
        service.createPaymentIntent('ord-paid', userA),
      ).rejects.toThrow(ConflictException);

      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-expired',
        userId: userA.userId,
        status: OrderStatus.PENDING,
        totalPrice: 5000,
        expiresAt: new Date(Date.now() - 5000),
      });

      await expect(
        service.createPaymentIntent('ord-expired', userA),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('missing-ord', userA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleWebhook (signature verification, paid/failed flows, idempotency)', () => {
    it('marks the Payment SUCCEEDED and transitions the Order to PAID on valid signed payment_intent.succeeded webhook', async () => {
      const { rawBody, signature } = createSignedWebhookRequest({
        id: 'evt_success_001',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_12345',
            object: 'payment_intent',
            amount: 12999,
            metadata: { orderId: 'ord-1', userId: userA.userId },
          },
        },
      });

      // Event not yet processed
      prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        // Found payment by providerPaymentId
        .mockResolvedValueOnce({
          id: 'pay-1',
          orderId: 'ord-1',
          providerPaymentId: 'pi_test_12345',
          status: PaymentStatus.PENDING,
        });

      prisma.payment.update.mockResolvedValue({});
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const response = await service.handleWebhook(rawBody, signature);

      expect(response).toEqual({
        received: true,
        duplicate: false,
        eventId: 'evt_success_001',
        eventType: 'payment_intent.succeeded',
      });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          status: PaymentStatus.SUCCEEDED,
          lastWebhookEventId: 'evt_success_001',
          failureMessage: null,
        },
      });

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ord-1',
          status: OrderStatus.PENDING,
        },
        data: {
          status: OrderStatus.PAID,
          paidAt: expect.any(Date) as Date,
        },
      });
    });

    it('replaying a webhook event changes nothing and returns duplicate: true', async () => {
      const { rawBody, signature } = createSignedWebhookRequest({
        id: 'evt_replay_001',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_12345',
            object: 'payment_intent',
            amount: 12999,
          },
        },
      });

      // Simulate that evt_replay_001 was already recorded on the payment
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'pay-1',
        orderId: 'ord-1',
        providerPaymentId: 'pi_test_12345',
        status: PaymentStatus.SUCCEEDED,
        lastWebhookEventId: 'evt_replay_001',
      });

      const response = await service.handleWebhook(rawBody, signature);

      expect(response).toEqual({
        received: true,
        duplicate: true,
        eventId: 'evt_replay_001',
        eventType: 'payment_intent.succeeded',
      });

      // Zero writes executed on replay
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a bad or tampered webhook signature with 400 BadRequestException', async () => {
      const payload = Buffer.from(
        JSON.stringify({
          id: 'evt_forged',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_test_12345' } },
        }),
      );

      await expect(
        service.handleWebhook(payload, 't=123456789,v1=bad_forged_signature'),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a tampered payload even when signed with a formerly valid header', async () => {
      const { signature } = createSignedWebhookRequest({
        id: 'evt_valid_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_1', amount: 1000 } },
      });

      // Attacker modifies payload body
      const tamperedBody = Buffer.from(
        JSON.stringify({
          id: 'evt_valid_1',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_test_2', amount: 999999 } },
        }),
      );

      await expect(
        service.handleWebhook(tamperedBody, signature),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks Payment FAILED with failureMessage on payment_intent.payment_failed without marking Order PAID', async () => {
      const { rawBody, signature } = createSignedWebhookRequest({
        id: 'evt_fail_001',
        object: 'event',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_fail_99',
            object: 'payment_intent',
            last_payment_error: {
              message: 'Your card has insufficient funds.',
            },
          },
        },
      });

      prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay-99',
          orderId: 'ord-99',
          providerPaymentId: 'pi_test_fail_99',
          status: PaymentStatus.PENDING,
        });

      prisma.payment.update.mockResolvedValue({});

      const response = await service.handleWebhook(rawBody, signature);

      expect(response).toEqual({
        received: true,
        duplicate: false,
        eventId: 'evt_fail_001',
        eventType: 'payment_intent.payment_failed',
      });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-99' },
        data: {
          status: PaymentStatus.FAILED,
          lastWebhookEventId: 'evt_fail_001',
          failureMessage: 'Your card has insufficient funds.',
        },
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });
});
