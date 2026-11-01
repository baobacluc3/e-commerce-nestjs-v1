import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementType } from '../../generated/prisma/enums';

export class StockMovementResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ enum: StockMovementType })
  type!: StockMovementType;

  @ApiProperty({ description: 'Number of units affected' })
  quantity!: number;

  @ApiProperty({ description: 'Stock balance after movement' })
  balanceAfter!: number;

  @ApiPropertyOptional()
  reason!: string | null;

  @ApiPropertyOptional()
  referenceId!: string | null;

  @ApiPropertyOptional()
  userId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class PaginatedStockMovementsResponseDto {
  @ApiProperty({ type: [StockMovementResponseDto] })
  items!: StockMovementResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}
