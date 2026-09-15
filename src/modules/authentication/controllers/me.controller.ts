import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContextService, SkipTenantStatusCheck } from '../../../common';
import { MyOrganizationEntity } from '../entities';
import { AuthenticationService } from '../services/authentication.service';

/**
 * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — a small,
 * deliberately separate controller from AuthenticationController: these are
 * read-only "what can I do / who am I" lookups, not authentication actions,
 * and (organizations list especially) are conceptually a cross-tenant view
 * rather than a same-tenant one — a clean extension point of its own rather
 * than folding into `/auth`.
 *
 * @SkipTenantStatusCheck applies here for the same reason it applies to
 * AuthenticationController: a caller whose CURRENT tenant is suspended must
 * still be able to see their own available organizations and switch away
 * from it, not be locked out of every endpoint entirely.
 */
@ApiTags('me')
@SkipTenantStatusCheck()
@Controller('me')
export class MeController {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly context: RequestContextService,
  ) {}

  @Get('organizations')
  @ApiOperation({
    summary: 'List every organization the caller could switch their active context to',
    description: 'Every organization this global Identity holds an ACTIVE membership in, across every tenant.',
  })
  listOrganizations(): Promise<MyOrganizationEntity[]> {
    return this.authenticationService.listMyOrganizations(this.context.userId!);
  }

  @Get('context')
  @ApiOperation({
    summary: "The caller's current tenant/organization context",
    description: 'Equivalent to the tenant/organizationContext portion of GET /auth/me, as its own lightweight call.',
  })
  async getContext() {
    const me = await this.authenticationService.getMe(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
      this.context.organizationId,
    );
    return { tenant: me.tenant, organizationContext: me.organizationContext };
  }
}
