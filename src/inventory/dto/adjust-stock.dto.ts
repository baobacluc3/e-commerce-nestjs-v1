import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/transforms';

export class AdjustStockDto {
  @ApiProperty({
    example: 42,
    description: 'The actual physical stock count to set',
  })
  @IsInt()
  @Min(0)
  newStock!: number;

  @ApiProperty({
    example: 'Physical warehouse count adjustment',
    description: 'Mandatory explanation for audit compliance',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}
