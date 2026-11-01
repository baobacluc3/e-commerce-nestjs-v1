import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/transforms';

export class RestockDto {
  @ApiProperty({
    example: 50,
    description: 'Number of units to add to inventory',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    example: 'Shipment received from supplier',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    example: 'PO-2026-8891',
    description: 'Purchase order or supplier delivery note number',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(128)
  referenceId?: string;
}
