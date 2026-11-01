import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../../generated/prisma/enums';

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({ example: 'stripe' })
  provider!: string;

  @ApiProperty({ example: 'pi_test_0192e20db8d472218eb9ccefa93430ee' })
  providerPaymentId!: string;

  @ApiPropertyOptional({
    description: 'Client secret for completing payment on the frontend',
  })
  clientSecret!: string | null;

  @ApiProperty({ description: 'Payment amount in integer cents' })
  amount!: number;

  @ApiProperty({ example: 'usd' })
  currency!: string;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiPropertyOptional()
  failureMessage!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class WebhookResponseDto {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiProperty({
    example: false,
    description: 'True when the webhook event was already processed',
  })
  duplicate!: boolean;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  eventType!: string;
}
