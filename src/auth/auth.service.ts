import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PublicUser, UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      return await this.usersService.create({
        email: dto.email,
        passwordHash,
        name: dto.name,
      });
    } catch (error) {
      // P2002 = unique constraint failed. The only unique field we set is email.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }
}
