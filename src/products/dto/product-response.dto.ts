import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  sku!: string;

  @ApiPropertyOptional()
  description!: string | null;

  @ApiProperty({ description: 'Price in integer cents' })
  price!: number;

  @ApiProperty({ description: 'Current available stock' })
  stock!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional()
  categoryId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PaginatedProductsResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}
