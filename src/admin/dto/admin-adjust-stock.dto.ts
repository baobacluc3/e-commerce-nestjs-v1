import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../common/transforms';

export class AdminAdjustStockDto {
  @ApiProperty({ description: 'Product UUID to adjust' })
  @IsUUID('all')
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    example: 25,
    description: 'Exact counted inventory quantity to set',
  })
  @IsInt()
  @Min(0)
  newStock!: number;

  @ApiProperty({
    example: 'Q4 warehouse cycle count discrepancy correction',
    description: 'Mandatory reason for audit trail',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}
