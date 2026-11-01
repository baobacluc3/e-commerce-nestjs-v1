import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/transforms';

export class CancelOrderDto {
  @ApiPropertyOptional({
    example: 'Changed mind about order',
    description: 'Reason for cancelling the order',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(255)
  reason?: string;
}
