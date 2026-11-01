import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/transforms';

export class DecrementStockDto {
  @ApiProperty({ example: 2, description: 'Number of units to deduct' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Customer order purchase' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    example: 'ord_0192e20d-b8d4-7221-8eb9-ccefa93430ee',
    description: 'Associated order or invoice reference ID',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(128)
  referenceId?: string;
}
