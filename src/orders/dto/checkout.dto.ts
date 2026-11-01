import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/transforms';

export class CheckoutDto {
  @ApiPropertyOptional({
    example: 'idem_0192e20d-b8d4-7221-8eb9-ccefa93430ee',
    description:
      'Optional idempotency key to prevent duplicate orders on repeated requests (can also be sent via Idempotency-Key header)',
  })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(128)
  idempotencyKey?: string;
}
