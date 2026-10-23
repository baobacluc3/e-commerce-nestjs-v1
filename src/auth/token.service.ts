import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { Role } from '../generated/prisma/enums';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  // Short-lived JWT. The payload is `{ sub: userId, role }`.
  signAccessToken(userId: string, role: Role): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, role });
  }

  // 32 random bytes as base64url. It has no meaning, it is only a secret.
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // SHA-256 as 64 hex characters. We store this, never the token itself.
  // Same input always gives the same output, so we can look the row up.
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshExpiresAt(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * MS_PER_DAY);
  }
}
