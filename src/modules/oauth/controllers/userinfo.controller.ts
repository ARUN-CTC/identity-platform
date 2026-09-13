import { Controller, Get, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdentityMetricNames, IdentityMetrics, Public, RateLimited, RateLimitGuard, RequestContextService, USERINFO_POLICY_NAME } from '../../../common';
import { CurrentExternalPrincipal, ExpectedAudience } from '../../resource-server/decorators';
import { GENERIC_INVALID_TOKEN_MESSAGE, ResourceServerAuthError } from '../../resource-server/errors';
import { ResourceServerErrorFilter } from '../../resource-server/filters';
import { ExternalBearerAuthGuard } from '../../resource-server/guards';
import { AuthenticatedExternalPrincipal } from '../../resource-server/interfaces';
import { requireScope } from '../../resource-server/utils';
import { SecurityEventsService } from '../../security-audit/services';
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
 *
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md) — adds rate limiting
 * (`@RateLimited(USERINFO_POLICY_NAME)`) and durable audit events
 * (`OIDC_USERINFO_ACCESSED`/`OIDC_USERINFO_DENIED`, both carrying the
 * request's own correlation/trace id, never the token/nonce/any secret) —
 * closing a gap this controller previously had (Phase 2D.8 recorded no
 * audit trail for `/userinfo` at all).
 */
@ApiTags('oauth')
@Controller('oauth')
@Public() // bypasses the legacy (HS256) global JwtAuthGuard — this route's own authentication is ExternalBearerAuthGuard below, a structurally separate trust boundary (mirrors ResourceServerDemoController)
@UseGuards(RateLimitGuard, ExternalBearerAuthGuard)
@RateLimited(USERINFO_POLICY_NAME)
@ExpectedAudience(OIDC_USERINFO_AUDIENCE)
@UseFilters(ResourceServerErrorFilter)
export class UserInfoController {
  constructor(
    private readonly usersService: UsersService,
    private readonly securityEvents: SecurityEventsService,
    private readonly metrics: IdentityMetrics,
    private readonly context: RequestContextService,
  ) {}

  @Get('userinfo')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'OIDC UserInfo — returns claims for the authenticated principal, scope-gated', description: 'Requires an access token issued for the identity-platform-userinfo audience, carrying the openid scope. Never accepts an ID Token.' })
  async userInfo(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal): Promise<OidcUserClaims> {
    this.metrics.increment(IdentityMetricNames.OIDC_USERINFO_REQUESTS);

    // A SERVICE_ACCOUNT principal has no human identity to describe — this
    // is a type mismatch, not a mere scope shortfall (brief §21 error
    // semantics: invalid_token, never a silent/ambiguous 200).
    if (principal.type !== 'USER' || !principal.userId) {
      await this.deny(principal, 'not_a_user_principal');
      throw new ResourceServerAuthError('invalid_token', 'missing_required_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    try {
      requireScope(principal, OPENID_SCOPE);
    } catch (error) {
      await this.deny(principal, 'missing_openid_scope');
      throw error;
    }

    // `findGlobalById` — there is no ambient tenant context on this request
    // (authenticated via `ExternalBearerAuthGuard`, not `JwtAuthGuard`;
    // `RequestContextService.tenantId` is never set here) — `UsersService.findOne()`
    // would otherwise throw ("No tenant context on this request") via
    // `UsersRepository.findById()`'s own ambient-context requirement.
    const user = await this.usersService.findGlobalById(principal.userId);
    if (!user) {
      await this.deny(principal, 'user_not_found');
      throw new ResourceServerAuthError('invalid_token', 'missing_required_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    await this.securityEvents.record({
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      eventType: 'OIDC_USERINFO_ACCESSED',
      resourceType: 'SecurityUser',
      resourceId: principal.userId,
      correlationId: this.context.traceId,
      metadata: { result: 'SUCCESS', clientId: principal.clientId, jti: principal.jti },
    });

    return mapOidcUserClaims(
      { id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email, emailVerifiedAt: user.emailVerifiedAt },
      principal.scopes,
    );
  }

  /** One chokepoint for every denial path — never logs the bearer token itself, only the (already-validated) principal's own inert facts and a stable reason code. */
  private async deny(principal: AuthenticatedExternalPrincipal, reasonCode: string): Promise<void> {
    this.metrics.increment(IdentityMetricNames.OIDC_USERINFO_DENIED);
    await this.securityEvents.record({
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      eventType: 'OIDC_USERINFO_DENIED',
      resourceType: 'SecurityUser',
      correlationId: this.context.traceId,
      metadata: { result: 'DENIED', reasonCode, clientId: principal.clientId, jti: principal.jti },
    });
  }
}
