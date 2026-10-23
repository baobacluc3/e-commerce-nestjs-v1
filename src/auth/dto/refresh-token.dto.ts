import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Used by refresh and logout.
export class RefreshTokenDto {
  @ApiProperty({ example: 'kP3v0Qx1m2wJ8k9n0b7r6t5y4u3i2o1p0a9s8d7f6g5' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}
