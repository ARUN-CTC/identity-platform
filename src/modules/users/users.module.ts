import { Module } from '@nestjs/common';
import { JwtModule } from '../jwt/jwt.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OrganizationsModule } from '../organizations/organizations.module';
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
  // MailerModule, no explicit import needed. MembershipsModule/
  // OrganizationsModule: Phase 2A — user creation/invitation now always
  // targets one Organization, and role grants/resolution now check
  // Membership (docs/PHASE_2A.md).
  imports: [SecurityAuditModule, SessionsModule, JwtModule, MembershipsModule, OrganizationsModule],
  controllers: [UsersController, UserRolesController, InvitationsController],
  providers: [UsersService, UsersRepository, UserRolesService, UserRolesRepository, UserInvitationsService],
  exports: [UsersService, UserRolesService, UserInvitationsService],
})
export class UsersModule {}
