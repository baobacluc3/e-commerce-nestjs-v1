import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({
    description: 'Short-lived JWT. Send it as `Authorization: Bearer <token>`.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Random string used once to get a new pair of tokens.',
    example: 'kP3v0Qx1m2wJ8k9n0b7r6t5y4u3i2o1p0a9s8d7f6g5',
  })
  refreshToken!: string;
}
