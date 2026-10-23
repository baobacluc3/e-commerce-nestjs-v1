import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums';

// The only shape of a user that is ever sent to a client.
// It has no password hash on purpose.
export class UserResponseDto {
  @ApiProperty({ example: '0199a000-0000-7000-8000-000000000001' })
  id!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ enum: Role, example: Role.CUSTOMER })
  role!: Role;

  @ApiProperty({ example: '2026-10-24T05:00:00.000Z' })
  createdAt!: Date;
}
