import { ApiProperty } from '@nestjs/swagger';

export class AdminOrdersByStatusDto {
  @ApiProperty()
  PENDING!: number;

  @ApiProperty()
  PAID!: number;

  @ApiProperty()
  SHIPPED!: number;

  @ApiProperty()
  COMPLETED!: number;

  @ApiProperty()
  CANCELLED!: number;
}

export class AdminMetricsResponseDto {
  @ApiProperty({
    description:
      'Gross revenue in integer cents (sum of PAID, SHIPPED, and COMPLETED orders)',
  })
  grossRevenueCents!: number;

  @ApiProperty({ description: 'Total number of orders placed across all time' })
  totalOrders!: number;

  @ApiProperty({ type: AdminOrdersByStatusDto })
  ordersByStatus!: AdminOrdersByStatusDto;

  @ApiProperty({ description: 'Total registered customers' })
  totalCustomers!: number;

  @ApiProperty({ description: 'Total active products in store catalog' })
  totalActiveProducts!: number;

  @ApiProperty({
    description:
      'Number of active products at or below low-stock threshold (10 units)',
  })
  lowStockProductCount!: number;
}
