import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser, UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  // A real argon2 hash of a random string. Login verifies against it when the
  // email does not exist, so both cases take about the same time.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwordService.hash(randomUUID());
  }

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

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.usersService.findByEmail(dto.email);

    // Always run one argon2 verify, even for an unknown email.
    const passwordIsCorrect = await this.passwordService.verify(
      user?.passwordHash ?? this.dummyHash,
      dto.password,
    );

    // Same error for "no such email" and "wrong password" (no user enumeration).
    if (!user || !passwordIsCorrect) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Every login starts a new family of refresh tokens.
    return this.issueTokens(this.prisma, user.id, user.role, randomUUID());
  }

  // Creates an access token and a new refresh token, and saves the refresh
  // token's hash. `db` can be a transaction client, so callers can make this
  // part of a bigger all-or-nothing change.
  private async issueTokens(
    db: Prisma.TransactionClient,
    userId: string,
    role: Role,
    familyId: string,
  ): Promise<TokenPair> {
    const refreshToken = this.tokenService.generateRefreshToken();

    await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.tokenService.hashToken(refreshToken),
        expiresAt: this.tokenService.refreshExpiresAt(),
      },
    });

    const accessToken = await this.tokenService.signAccessToken(userId, role);
    return { accessToken, refreshToken };
  }
}
