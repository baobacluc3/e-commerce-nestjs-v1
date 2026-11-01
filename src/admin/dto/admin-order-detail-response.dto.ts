import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/enums';
import { OrderItemResponseDto } from '../../orders/dto/order-response.dto';
import { PaymentResponseDto } from '../../payments/dto/payment-response.dto';

export class AdminCustomerSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;
}

export class AdminOrderListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: AdminCustomerSummaryDto })
  user!: AdminCustomerSummaryDto;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ description: 'Total order price in integer cents' })
  totalPrice!: number;

  @ApiPropertyOptional()
  idempotencyKey!: string | null;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  expiresAt!: Date;

  @ApiPropertyOptional()
  paidAt!: Date | null;

  @ApiPropertyOptional()
  cancelledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class PaginatedAdminOrdersResponseDto {
  @ApiProperty({ type: [AdminOrderListItemDto] })
  items!: AdminOrderListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class AdminOrderDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: AdminCustomerSummaryDto })
  user!: AdminCustomerSummaryDto;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ description: 'Total order price in integer cents' })
  totalPrice!: number;

  @ApiPropertyOptional()
  idempotencyKey!: string | null;

  @ApiProperty()
  expiresAt!: Date;

  @ApiPropertyOptional()
  paidAt!: Date | null;

  @ApiPropertyOptional()
  cancelledAt!: Date | null;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: [PaymentResponseDto] })
  payments!: PaymentResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
