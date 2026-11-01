import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import {
  PaymentResponseDto,
  WebhookResponseDto,
} from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create (or reuse) a Stripe PaymentIntent for a PENDING order',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiConflictResponse({
    description: 'Order is already paid, cancelled, or expired',
  })
  @ApiForbiddenResponse({ description: 'Cannot pay for another user order' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @Post('orders/:orderId/intent')
  async createIntent(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.createPaymentIntent(orderId, user);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List payment attempts for an order (owner or Admin only)',
  })
  @ApiOkResponse({ type: [PaymentResponseDto] })
  @ApiForbiddenResponse({
    description: 'Cannot view payments for another user order',
  })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @Get('orders/:orderId')
  async findForOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentResponseDto[]> {
    return this.paymentsService.findPaymentsForOrder(orderId, user);
  }

  @Public()
  @ApiOperation({
    summary:
      'Stripe signed webhook endpoint (idempotently handles payment_intent.succeeded and payment_intent.payment_failed)',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Cryptographic Stripe HMAC-SHA256 webhook signature',
  })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiBadRequestResponse({
    description: 'Missing or invalid webhook signature',
  })
  @HttpCode(HttpStatus.OK)
  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<WebhookResponseDto> {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    const rawBody =
      request.rawBody ??
      (typeof request.body === 'string'
        ? Buffer.from(request.body)
        : Buffer.from(JSON.stringify(request.body ?? {})));

    return this.paymentsService.handleWebhook(rawBody, signature);
  }
}
