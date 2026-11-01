import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/enums';

export class OrderItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productSku!: string;

  @ApiProperty({
    description: 'Frozen unit price in integer cents at checkout',
  })
  unitPrice!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    description: 'Frozen subtotal in integer cents (unitPrice * quantity)',
  })
  subtotal!: number;

  @ApiProperty()
  createdAt!: Date;
}

export class OrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  items!: OrderResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}
