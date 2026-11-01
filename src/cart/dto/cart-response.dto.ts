import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CartItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productSku!: string;

  @ApiProperty({ description: 'Current unit price in integer cents' })
  unitPrice!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    description: 'Subtotal in integer cents (unitPrice * quantity)',
  })
  subtotal!: number;

  @ApiProperty({ description: 'Current available stock for this product' })
  availableStock!: number;

  @ApiProperty({
    description: 'Indicates if product is active and has sufficient stock',
  })
  isAvailable!: boolean;

  @ApiPropertyOptional({
    description: 'Notice regarding stock availability or status',
  })
  availabilityNotice?: string;
}

export class CartResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];

  @ApiProperty({ description: 'Total item units in cart' })
  totalItems!: number;

  @ApiProperty({
    description:
      'Total price in integer cents calculated exclusively by server',
  })
  totalPrice!: number;

  @ApiProperty({
    description:
      'Indicates if every item in the cart is available for checkout',
  })
  isCheckoutReady!: boolean;

  @ApiProperty()
  updatedAt!: Date;
}
