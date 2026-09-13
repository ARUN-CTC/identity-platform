import { Controller, Get, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common';
import { CurrentExternalPrincipal, ExpectedAudience } from '../../resource-server/decorators';
import { GENERIC_INVALID_TOKEN_MESSAGE, ResourceServerAuthError } from '../../resource-server/errors';
import { ResourceServerErrorFilter } from '../../resource-server/filters';
import { ExternalBearerAuthGuard } from '../../resource-server/guards';
import { AuthenticatedExternalPrincipal } from '../../resource-server/interfaces';
import { requireScope } from '../../resource-server/utils';
import { UsersService } from '../../users/services';
import { OIDC_USERINFO_AUDIENCE, OPENID_SCOPE } from '../constants/oidc.constants';
import { OidcUserClaims } from '../interfaces';
import { mapOidcUserClaims } from '../utils';

/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §14, brief §21-24) — `GET /oauth/userinfo`.
 * Authenticates with the SAME Phase 2D.5 Resource Server mechanism as any
 * other protected route (`ExternalBearerAuthGuard`/`ExternalAccessTokenValidator`)
 * — NEVER an ID Token (structurally impossible: an ID Token carries no
 * `tenant_id`/`jti`, which `ExternalAccessTokenValidator` requires, and
 * additionally carries `token_use: 'id_token'`, which that validator now
 * explicitly rejects — see its own updated doc comment). This is the one
 * deliberate point of contact between the `oauth` (issuance) and
 * `resource-server` (consumption) modules — UserInfo is, structurally, just
 * another protected resource-server route, applied to the Identity
 * Platform's own identity data, not a new kind of endpoint.
 *
 * Requires the dedicated `OIDC_USERINFO_AUDIENCE` (brief §22 — never
 * accepts an arbitrary Identity-Platform-issued access token merely because
 * it is otherwise valid) AND the `openid` scope on the token itself (an
 * access token from a NON-OIDC authorization request, even one that
 * happens to carry the right audience, was never an OIDC transaction and
 * must not be usable here).
 *
 * Derives the subject EXCLUSIVELY from the validated principal
 * (`principal.userId`) — never from a query parameter, header, or request
 * body (brief §24 — `GET /userinfo?user_id=<someone-else>` cannot work;
 * there is no code path here that even reads such a parameter).
 */
@ApiTags('oauth')
@Controller('oauth')
@Public() // bypasses the legacy (HS256) global JwtAuthGuard — this route's own authentication is ExternalBearerAuthGuard below, a structurally separate trust boundary (mirrors ResourceServerDemoController)
@UseGuards(ExternalBearerAuthGuard)
@ExpectedAudience(OIDC_USERINFO_AUDIENCE)
@UseFilters(ResourceServerErrorFilter)
export class UserInfoController {
  constructor(private readonly usersService: UsersService) {}

  @Get('userinfo')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'OIDC UserInfo — returns claims for the authenticated principal, scope-gated', description: 'Requires an access token issued for the identity-platform-userinfo audience, carrying the openid scope. Never accepts an ID Token.' })
  async userInfo(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal): Promise<OidcUserClaims> {
    // A SERVICE_ACCOUNT principal has no human identity to describe — this
    // is a type mismatch, not a mere scope shortfall (brief §21 error
    // semantics: invalid_token, never a silent/ambiguous 200).
    if (principal.type !== 'USER' || !principal.userId) {
      throw new ResourceServerAuthError('invalid_token', 'missing_required_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    requireScope(principal, OPENID_SCOPE);

    // `findGlobalById` — there is no ambient tenant context on this request
    // (authenticated via `ExternalBearerAuthGuard`, not `JwtAuthGuard`;
    // `RequestContextService.tenantId` is never set here) — `UsersService.findOne()`
    // would otherwise throw ("No tenant context on this request") via
    // `UsersRepository.findById()`'s own ambient-context requirement.
    const user = await this.usersService.findGlobalById(principal.userId);
    if (!user) {
      throw new ResourceServerAuthError('invalid_token', 'missing_required_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    return mapOidcUserClaims(
      { id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email, emailVerifiedAt: user.emailVerifiedAt },
      principal.scopes,
    );
  }
}
