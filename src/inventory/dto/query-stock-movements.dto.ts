import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { StockMovementType } from '../../generated/prisma/enums';

export class QueryStockMovementsDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filter movements by product ID',
  })
  @IsUUID('all')
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({
    enum: StockMovementType,
    description: 'Filter by movement type: IN, OUT, or ADJUSTMENT',
  })
  @IsEnum(StockMovementType)
  @IsOptional()
  type?: StockMovementType;
}
