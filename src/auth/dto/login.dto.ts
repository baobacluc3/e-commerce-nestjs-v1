import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimAndLowercase } from '../../common/transforms';

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com' })
  @Transform(trimAndLowercase)
  @IsEmail()
  email!: string;

  // No minimum length here: login only checks the password, it does not judge it.
  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password!: string;
}
