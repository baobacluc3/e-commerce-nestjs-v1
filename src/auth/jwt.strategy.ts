import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../config/app-config.service';
import { Role } from '../generated/prisma/enums';
import type { AuthUser } from './current-user.decorator';

// What we put inside the access token when we sign it.
interface JwtPayload {
  sub: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: AppConfigService) {
    super({
      // Reads "Authorization: Bearer <token>".
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // An expired token is rejected with 401.
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessSecret,
      algorithms: ['HS256'],
    });
  }

  // Runs only after the signature and expiry are checked.
  // The result becomes `request.user`.
  validate(payload: JwtPayload): AuthUser {
    return { userId: payload.sub, role: payload.role };
  }
}
