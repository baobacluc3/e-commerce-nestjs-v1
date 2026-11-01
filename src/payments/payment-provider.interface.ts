export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CreatePaymentIntentInput {
  orderId: string;
  userId: string;
  amount: number; // integer cents
  currency: string;
  idempotencyKey?: string;
}

export interface CreatePaymentIntentResult {
  providerPaymentId: string;
  clientSecret: string;
}

export interface VerifiedWebhookEvent {
  id: string;
  type: string;
  providerPaymentId: string;
  orderId?: string;
  amount?: number;
  failureMessage?: string;
}

export interface PaymentProvider {
  readonly name: string;

  createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentResult>;

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): VerifiedWebhookEvent;
}
