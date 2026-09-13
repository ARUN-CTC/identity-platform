import { Module } from '@nestjs/common';
import { JwtModule } from '../jwt/jwt.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UserRolesController, UsersController } from './controllers';
import { InvitationsController } from './invitations/controllers';
import { UserInvitationsService } from './invitations/services';
import { UserRolesRepository, UsersRepository } from './repositories';
import { UserRolesService, UsersService } from './services';

@Module({
  // SessionsModule: so suspend/deactivate can revoke the target user's
  // sessions. JwtModule (TokenService + InvitationTokensRepository): for
  // UserInvitationsService, same token infra AuthenticationService reuses
  // for forgot/reset-password. MailerService comes from the @Global()
  // MailerModule, no explicit import needed.
  imports: [SecurityAuditModule, SessionsModule, JwtModule],
  controllers: [UsersController, UserRolesController, InvitationsController],
  providers: [UsersService, UsersRepository, UserRolesService, UserRolesRepository, UserInvitationsService],
  exports: [UsersService, UserRolesService, UserInvitationsService],
})
export class UsersModule {}
