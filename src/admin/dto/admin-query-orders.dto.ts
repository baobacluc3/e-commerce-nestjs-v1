import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { OrderStatus } from '../../generated/prisma/enums';

export class AdminQueryOrdersDto {
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

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Filter by specific customer UUID' })
  @IsUUID('all')
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: 'Minimum total price in cents' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum total price in cents' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Filter orders created on or after date',
  })
  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Filter orders created on or before date',
  })
  @IsDateString()
  @IsOptional()
  toDate?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'totalPrice', 'status'],
    default: 'createdAt',
  })
  @IsIn(['createdAt', 'totalPrice', 'status'])
  @IsOptional()
  sortBy: 'createdAt' | 'totalPrice' | 'status' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder: 'asc' | 'desc' = 'desc';
}
