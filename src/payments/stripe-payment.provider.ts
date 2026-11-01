import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { AppConfigService } from '../config/app-config.service';
import {
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  PaymentProvider,
  VerifiedWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(config: AppConfigService) {
    this.secretKey = config.stripeSecretKey;
    this.webhookSecret = config.stripeWebhookSecret;
    this.stripe = new Stripe(this.secretKey);
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentResult> {
    // Offline fallback when running locally without an external Stripe account
    if (this.secretKey === 'sk_test_local_placeholder') {
      const id = `pi_test_${randomUUID().replace(/-/g, '')}`;
      const secret = `${id}_secret_${randomBytes(12).toString('hex')}`;
      return Promise.resolve({
        providerPaymentId: id,
        clientSecret: secret,
      });
    }

    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amount,
        currency: input.currency,
        metadata: {
          orderId: input.orderId,
          userId: input.userId,
        },
        automatic_payment_methods: { enabled: true },
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );

    if (!intent.client_secret) {
      throw new BadRequestException(
        'Stripe did not return a client_secret for PaymentIntent',
      );
    }

    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret,
    };
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): VerifiedWebhookEvent {
    if (!signature || !signature.trim()) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    const obj = event.data.object as {
      id?: string;
      amount?: number;
      metadata?: Record<string, string>;
      last_payment_error?: { message?: string } | null;
    };

    if (!obj || typeof obj.id !== 'string') {
      throw new BadRequestException('Malformed webhook event payload');
    }

    return {
      id: event.id,
      type: event.type,
      providerPaymentId: obj.id,
      orderId: obj.metadata?.orderId,
      amount: typeof obj.amount === 'number' ? obj.amount : undefined,
      failureMessage: obj.last_payment_error?.message,
    };
  }
}
