import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { OrderStatus, PaymentStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentResponseDto,
  WebhookResponseDto,
} from './dto/payment-response.dto';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type { PaymentProvider } from './payment-provider.interface';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * Creates (or reuses an existing PENDING) PaymentIntent for a PENDING, non-expired order.
   */
  async createPaymentIntent(
    orderId: string,
    actor: AuthUser,
  ): Promise<PaymentResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
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
      throw new ConflictException('Order is already paid');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Cannot initiate payment for order in '${order.status}' status`,
      );
    }

    if (order.expiresAt <= new Date()) {
      throw new ConflictException(
        'Order has expired and can no longer be paid',
      );
    }

    // Reuse an existing PENDING payment intent for this order if one exists
    const existingPending = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      return existingPending;
    }

    const intent = await this.paymentProvider.createPaymentIntent({
      orderId: order.id,
      userId: order.userId,
      amount: order.totalPrice,
      currency: 'usd',
    });

    return this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: this.paymentProvider.name,
        providerPaymentId: intent.providerPaymentId,
        clientSecret: intent.clientSecret,
        amount: order.totalPrice,
        currency: 'usd',
        status: PaymentStatus.PENDING,
      },
    });
  }

  /**
   * Verifies the cryptographic webhook signature and processes payment events idempotently:
   * - `payment_intent.succeeded`: marks Payment SUCCEEDED and transitions Order to PAID.
   * - `payment_intent.payment_failed`: marks Payment FAILED and records failure message.
   * - Replaying a webhook or sending a duplicate event changes nothing.
   */
  async handleWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<WebhookResponseDto> {
    const event = this.paymentProvider.constructWebhookEvent(
      rawBody,
      signature,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Check if this exact webhook event ID was already processed
      const alreadyProcessedEvent = await tx.payment.findUnique({
        where: { lastWebhookEventId: event.id },
      });

      if (alreadyProcessedEvent) {
        return {
          received: true,
          duplicate: true,
          eventId: event.id,
          eventType: event.type,
        };
      }

      // 2. Locate the payment record by providerPaymentId
      const payment = await tx.payment.findUnique({
        where: { providerPaymentId: event.providerPaymentId },
      });

      if (!payment) {
        return {
          received: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
        };
      }

      // 3. Once a payment has SUCCEEDED, any duplicate or out-of-order event is a no-op
      if (payment.status === PaymentStatus.SUCCEEDED) {
        return {
          received: true,
          duplicate: true,
          eventId: event.id,
          eventType: event.type,
        };
      }

      if (event.type === 'payment_intent.succeeded') {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            lastWebhookEventId: event.id,
            failureMessage: null,
          },
        });

        await tx.order.updateMany({
          where: {
            id: payment.orderId,
            status: OrderStatus.PENDING,
          },
          data: {
            status: OrderStatus.PAID,
            paidAt: new Date(),
          },
        });

        return {
          received: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
        };
      }

      if (event.type === 'payment_intent.payment_failed') {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            lastWebhookEventId: event.id,
            failureMessage: event.failureMessage ?? 'Payment attempt failed',
          },
        });

        return {
          received: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
        };
      }

      return {
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
      };
    });
  }

  /**
   * Lists payment attempts for a specific order (owner or ADMIN only).
   */
  async findPaymentsForOrder(
    orderId: string,
    actor: AuthUser,
  ): Promise<PaymentResponseDto[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID '${orderId}' not found`);
    }

    if (order.userId !== actor.userId && actor.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Forbidden: you do not have permission to view payments for this order',
      );
    }

    return this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
