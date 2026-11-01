import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): JwtModuleOptions => ({
        secret: config.jwtAccessSecret,
        signOptions: {
          // e.g. "15m". The type is a template string, so we cast it.
          expiresIn: config.jwtAccessTtl as NonNullable<
            JwtModuleOptions['signOptions']
          >['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    // Registering the guards as APP_GUARD makes them apply globally across the app.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [RolesGuard],
})
export class AuthModule {}
