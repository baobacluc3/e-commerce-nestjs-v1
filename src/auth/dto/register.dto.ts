import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Runs before validation: " Jane@Example.COM " becomes "jane@example.com".
const trimAndLowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// There is no `role` field here on purpose. The global ValidationPipe uses
// `forbidNonWhitelisted`, so a body with `role` is rejected with 400.
export class RegisterDto {
  @ApiProperty({ example: 'jane@example.com' })
  @Transform(trimAndLowercase)
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
