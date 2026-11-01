import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { trim } from '../../common/transforms';

export class QueryProductsDto {
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

  @ApiPropertyOptional({ example: 'keyboard' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsUUID('all')
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Minimum price in cents' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price in cents' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only return products in stock' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  inStock?: boolean;

  @ApiPropertyOptional({
    enum: ['name', 'price', 'createdAt', 'stock'],
    default: 'createdAt',
  })
  @IsIn(['name', 'price', 'createdAt', 'stock'])
  @IsOptional()
  sortBy: 'name' | 'price' | 'createdAt' | 'stock' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder: 'asc' | 'desc' = 'desc';
}
