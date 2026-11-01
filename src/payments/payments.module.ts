import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripePaymentProvider } from './stripe-payment.provider';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useExisting: StripePaymentProvider,
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
