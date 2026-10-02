import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { DatabaseModule } from '../database/database.module';
import { getJwtKeyId, getJwtSecret } from '../config/environment';
import { NotificationModule } from '../notification/notification.module';
import { PasswordResetService } from './password-reset.service';
import { MfaService } from './mfa.service';
import { ACADEMIC_IDENTITY_PROVIDER } from './academic-identity.contract';
import { PrismaAcademicIdentityProvider } from './academic-identity.provider';

@Module({
  imports: [
    DatabaseModule,
    NotificationModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getJwtSecret(),
        // keyid tags every issued token's header with the active signing key's id, so a
        // verifier can support JWT_SECRET rotation with an overlap window (see
        // src/auth/jwt-verification.ts) instead of a hard, all-sessions-drop cutover.
        signOptions: { expiresIn: '8h', keyid: getJwtKeyId() },
      }),
    }),
  ],
  providers: [
    AuthService,
    PasswordResetService,
    MfaService,
    JwtStrategy,
    PrismaAcademicIdentityProvider,
    { provide: ACADEMIC_IDENTITY_PROVIDER, useExisting: PrismaAcademicIdentityProvider },
  ],
  controllers: [AuthController],
  exports: [JwtModule, PrismaAcademicIdentityProvider],
})
export class AuthModule {}
