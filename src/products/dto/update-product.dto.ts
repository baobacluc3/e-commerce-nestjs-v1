import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../common/transforms';

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Wireless Ergonomic Keyboard v2' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'wireless-ergonomic-keyboard-v2' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 5499, description: 'Price in integer cents' })
  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '0192e20d-b8d4-7221-8eb9-ccefa93430ee' })
  @IsUUID('all')
  @IsOptional()
  categoryId?: string;
}
