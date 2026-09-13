import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { TokenService } from './services/token.service';
import {
  RefreshTokensRepository,
  PasswordResetTokensRepository,
  InvitationTokensRepository,
} from './repositories';

@Module({
  imports: [
    NestJwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        // Numeric env vars come back from ConfigService as strings — coerced explicitly (no Joi/class-validator env schema in Phase 1).
        signOptions: { expiresIn: Number(config.get<string>('JWT_ACCESS_TOKEN_TTL')) },
      }),
    }),
  ],
  providers: [TokenService, RefreshTokensRepository, PasswordResetTokensRepository, InvitationTokensRepository],
  exports: [TokenService, RefreshTokensRepository, PasswordResetTokensRepository, InvitationTokensRepository],
})
export class JwtModule {}
