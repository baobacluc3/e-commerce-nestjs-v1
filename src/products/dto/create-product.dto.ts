import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../common/transforms';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Ergonomic Keyboard' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'KB-ERG-001' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku!: string;

  @ApiPropertyOptional({ example: 'wireless-ergonomic-keyboard' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Ergonomic split wireless keyboard with mechanical switches',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    example: 4999,
    description: 'Price in integer cents ($49.99)',
  })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'Initial stock level',
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  initialStock?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '0192e20d-b8d4-7221-8eb9-ccefa93430ee' })
  @IsUUID('all')
  @IsOptional()
  categoryId?: string;
}
