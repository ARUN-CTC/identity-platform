import { Injectable, Logger } from '@nestjs/common';
import { IdentityMetricNames, IdentityMetrics, parseScopeClaim, RequestContextService } from '../../../common';
import { ApplicationAudiencePolicy, ApplicationScopePolicy, OAuthApplicationPolicyService, OAuthEligibilityError } from '../../applications/policies';
import { MembershipsService } from '../../memberships/services';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { ProductAccessService } from '../../product-entitlements/services';
import { SecurityEventsService } from '../../security-audit/services';
import { TenantsService } from '../../tenants/services/tenants.service';
import { TokenService } from '../../jwt/services';
import { OPENID_SCOPE } from '../constants/oidc.constants';
import { OAuthTokenError } from '../errors';
import { isValidCodeChallengeFormat } from '../utils';
import { AuthorizationCodesRepository } from '../repositories';

export interface AuthorizeRequest {
  responseType?: string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  audience?: string;
  organizationId?: string;
  /** Phase 2D.8 (docs/OIDC_PROVIDER.md §4) — mandatory when `scope` includes `openid`; ignored (never required) for an ordinary OAuth-only request. */
  nonce?: string;
}

/** Success or (post-redirect_uri-validation) denial — both are delivered as an HTTP redirect. Never used for a PRE-redirect_uri-validation failure, which throws `OAuthTokenError` directly instead (brief §26). */
export type AuthorizeResult =
  | { kind: 'issued'; redirectUri: string; code: string; state?: string }
  | { kind: 'denied'; redirectUri: string; error: string; errorDescription: string; state?: string };

const FORBIDDEN_AUDIENCE_VALUES = new Set(['*', 'all', 'any']);

/**
 * Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md) — `GET /oauth/authorize`
 * business logic. Runs BEHIND the platform's existing, global `JwtAuthGuard`
 * (this controller is deliberately never `@Public()`) — by the time this
 * service is called, `RequestContextService` already carries a
 * cryptographically verified, session-revocation-checked human identity
 * (tenantId/userId/organizationId). No new login mechanism is built here
 * (brief §19) — an unauthenticated request never reaches this class at all;
 * JwtAuthGuard rejects it first with the platform's own standard 401.
 *
 * Validation order is the single most security-critical property of this
 * class (brief §9/§26): `client_id` and `redirect_uri` are validated FIRST,
 * together, via the exact-match `RedirectUriPolicy` already established in
 * Phase 2D.2 — every failure up to and including that point throws
 * `OAuthTokenError` directly (a JSON response, never a redirect, since the
 * redirect_uri is not yet trusted). Only once redirect_uri is confirmed
 * registered does every subsequent failure become a redirect carrying
 * `error`/`error_description`/`state` — never `access_token`, never any
 * secret, ever, in a URL (brief §27).
 */
@Injectable()
export class AuthorizeService {
  private readonly logger = new Logger(AuthorizeService.name);

  constructor(
    private readonly oauthPolicy: OAuthApplicationPolicyService,
    private readonly scopePolicy: ApplicationScopePolicy,
    private readonly audiencePolicy: ApplicationAudiencePolicy,
    private readonly memberships: MembershipsService,
    private readonly organizations: OrganizationsService,
    private readonly tenants: TenantsService,
    private readonly productAccess: ProductAccessService,
    private readonly tokenService: TokenService,
    private readonly authorizationCodes: AuthorizationCodesRepository,
    private readonly securityEvents: SecurityEventsService,
    private readonly context: RequestContextService,
    private readonly metrics: IdentityMetrics,
  ) {}

  async handle(request: AuthorizeRequest): Promise<AuthorizeResult> {
    this.metrics.increment(IdentityMetricNames.OAUTH_AUTHORIZE_REQUESTS);
    const tenantId = this.context.requireTenantId();
    const userId = this.context.userId;
    if (!userId) {
      // Unreachable in practice — JwtAuthGuard never sets tenantId without
      // userId — kept as defense in depth, never silently proceeding
      // without a known human principal (brief §19).
      throw new OAuthTokenError('invalid_request', 'No authenticated user on this request');
    }

    // --- 1. client_id (brief §8, threats #6) ------------------------------
    if (!request.clientId) {
      await this.auditDenied(tenantId, userId, 'missing_client_id', {});
      throw new OAuthTokenError('invalid_request', 'client_id is required');
    }

    // --- 2. redirect_uri — required BEFORE it can be trusted (brief §9, threats #7-12) ---
    if (!request.redirectUri) {
      await this.auditDenied(tenantId, userId, 'missing_redirect_uri', { clientId: request.clientId });
      throw new OAuthTokenError('invalid_request', 'redirect_uri is required');
    }

    // --- 3. Client + redirect_uri, together, via the Phase 2D.2 exact-match policy ---
    let application;
    try {
      application = await this.oauthPolicy.checkEligibility({
        clientId: request.clientId,
        grantType: 'authorization_code',
        redirectUri: request.redirectUri,
      });
    } catch (error) {
      if (error instanceof OAuthEligibilityError) {
        await this.auditDenied(tenantId, userId, error.reason, { clientId: request.clientId, redirectUri: request.redirectUri });
        // Every reason here — unknown/inactive client, product inactive,
        // grant type not allowed, redirect_uri not an exact registered
        // match — collapses to a DIRECT (never redirected) error. Brief
        // §26: "If redirect_uri has not been validated, DO NOT redirect."
        if (error.reason === 'redirect_uri_not_allowed') {
          throw new OAuthTokenError('invalid_request', 'redirect_uri does not exactly match a registered value');
        }
        throw new OAuthTokenError('unauthorized_client', 'This client is not authorized to use the authorization_code grant');
      }
      throw error;
    }

    // From here on, redirect_uri is a TRUSTED, exactly-registered value —
    // every subsequent failure is delivered as a redirect (brief §26).
    const redirectUri = request.redirectUri;
    const deny = async (error: string, errorDescription: string, reasonCode: string, metadata: Record<string, unknown> = {}): Promise<AuthorizeResult> => {
      await this.auditDenied(tenantId, userId, reasonCode, { clientId: request.clientId, applicationId: application.id, redirectUri, ...metadata });
      return { kind: 'denied', redirectUri, error, errorDescription, state: request.state };
    };

    // --- 4. response_type (brief §7, threats #4-5) ------------------------
    if (!request.responseType) {
      return deny('invalid_request', 'response_type is required', 'missing_response_type');
    }
    if (request.responseType !== 'code') {
      return deny('unsupported_response_type', 'Only response_type=code is supported', 'unsupported_response_type');
    }

    // --- 5. PKCE (brief §11/§12, threats #13-16) --------------------------
    if (!request.codeChallenge || !request.codeChallengeMethod) {
      return deny('invalid_request', 'code_challenge and code_challenge_method are required', 'missing_pkce');
    }
    if (request.codeChallengeMethod !== 'S256') {
      return deny('invalid_request', 'Only code_challenge_method=S256 is supported', 'unsupported_pkce_method');
    }
    if (!isValidCodeChallengeFormat(request.codeChallenge)) {
      return deny('invalid_request', 'code_challenge is malformed', 'malformed_code_challenge');
    }

    // --- 6. scope (brief §23, threats #25-26) -----------------------------
    const requestedScopes = parseScopeClaim(request.scope);
    if (!this.scopePolicy.validateRequestedScopes(application, requestedScopes)) {
      return deny('invalid_scope', 'One or more requested scopes are not allowed for this application', 'scope_not_allowed', { requestedScopes });
    }

    // --- 6a. OIDC nonce (Phase 2D.8, brief §8/§9) --------------------------
    // `openid` in the (already-validated-allowed) requested scopes is the
    // ONLY thing that makes this an OIDC transaction — never inferred any
    // other way (brief §5). Nonce is then mandatory, verbatim, never
    // substituted for or derived from `state`/`tenant_id`/`user_id`/
    // `session_id` (brief §9/§10 — `state` and `nonce` serve structurally
    // different purposes and are never conflated).
    const isOidc = requestedScopes.includes(OPENID_SCOPE);
    if (isOidc && !request.nonce) {
      return deny('invalid_request', 'nonce is required when scope includes openid', 'missing_nonce');
    }

    // --- 7. audience (brief §38) -------------------------------------------
    if (!request.audience) {
      return deny('invalid_request', 'audience is required', 'missing_audience');
    }
    if (FORBIDDEN_AUDIENCE_VALUES.has(request.audience.toLowerCase()) || request.audience.includes('*')) {
      return deny('invalid_request', 'Wildcard/implicit-all audience values are not permitted', 'wildcard_audience', { audience: request.audience });
    }
    if (!this.audiencePolicy.isAudienceAllowed(application, request.audience)) {
      return deny('invalid_target', 'The requested audience is not allowed for this application', 'audience_not_allowed', { audience: request.audience });
    }

    // --- 8. Organization context (brief §21/§22, threats #37-39) ----------
    // Never trusted merely because it was requested or is the session's
    // ambient selection — independently revalidated live, every time,
    // against the authenticated user's own Membership (mirrors
    // AuthenticationService's own refresh()-time revalidation).
    const requestedOrganizationId = request.organizationId ?? this.context.organizationId ?? null;
    let effectiveOrganizationId: string | null = null;
    if (requestedOrganizationId) {
      const [membershipActive, organization] = await Promise.all([
        this.memberships.hasActiveMembership(tenantId, userId, requestedOrganizationId),
        this.organizations.findByIdForTenant(tenantId, requestedOrganizationId),
      ]);
      if (!membershipActive || !organization || organization.status !== 'ACTIVE') {
        return deny('access_denied', 'You do not have access to this organization', 'organization_context_denied', { organizationId: requestedOrganizationId });
      }
      effectiveOrganizationId = requestedOrganizationId;
    }

    // --- 9. Tenant status (defense in depth — tenantId itself is already server-derived/trusted) ---
    const tenant = await this.tenants.findById(tenantId);
    if (tenant.status !== 'ACTIVE') {
      return deny('access_denied', 'This tenant is not active', 'tenant_inactive');
    }

    // --- 10. Product entitlement (brief §37 — authentication alone never implies product access) ---
    const access = await this.productAccess.canAccess(tenantId, application.productId);
    if (!access.allowed) {
      return deny('access_denied', 'This tenant is not entitled to use this application\'s product', access.reason ?? 'product_not_entitled', { productId: application.productId });
    }

    // --- 11. Issue the code (brief §13/§14/§27) ---------------------------
    const { plain, hash } = this.tokenService.generateAuthorizationCode(tenantId);
    const expiresAt = new Date(Date.now() + this.tokenService.authorizationCodeTtlSeconds * 1000);
    await this.authorizationCodes.create({
      codeHash: hash,
      applicationId: application.id,
      userId,
      tenantId,
      organizationId: effectiveOrganizationId,
      redirectUri,
      audience: request.audience,
      scopes: requestedScopes,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: 'S256',
      // Phase 2D.8 — bound here, verbatim, only when this is an OIDC
      // transaction; `null` for an ordinary OAuth-only code (brief §29).
      nonce: isOidc ? (request.nonce ?? null) : null,
      expiresAt,
    });

    await this.securityEvents.record({
      tenantId,
      actorUserId: userId,
      eventType: 'OAUTH_AUTHORIZATION_CODE_ISSUED',
      resourceType: 'Application',
      resourceId: application.id,
      metadata: {
        result: 'SUCCESS',
        applicationId: application.id,
        clientId: application.clientId,
        redirectUri,
        audience: request.audience,
        requestedScopes,
        organizationId: effectiveOrganizationId,
        // Phase 2D.8 — a safe boolean correlation fact only; the nonce
        // VALUE itself is never written to a durable audit record (brief
        // §44/§48 — "if nonce/state are included in audit context,
        // evaluate whether necessary; prefer safe correlation identifiers").
        oidcRequested: isOidc,
      },
      // Phase 2D.9 — the request's own trace/correlation id (already
      // established platform-wide by JwtAuthGuard, brief §6/§7) — never a
      // secret, never itself an authorization decision, only a
      // cross-log/cross-event correlation fact.
      correlationId: this.context.traceId,
    });
    this.metrics.increment(IdentityMetricNames.OAUTH_AUTHORIZATION_CODE_ISSUED);

    return { kind: 'issued', redirectUri, code: plain, state: request.state };
  }

  /**
   * Records a denial (never containing the client-controlled `state`
   * value, brief §44) as a tenant-scoped audit event. Used both for
   * PRE-redirect_uri-validation failures (thrown as `OAuthTokenError`
   * directly afterward) and for POST-redirect_uri-validation ones (returned
   * as a redirect via `deny()` above) — one chokepoint either way.
   */
  private async auditDenied(tenantId: string, userId: string, reasonCode: string, metadata: Record<string, unknown>): Promise<void> {
    this.metrics.increment(IdentityMetricNames.OAUTH_AUTHORIZE_DENIED);
    await this.securityEvents.record({
      tenantId,
      actorUserId: userId,
      eventType: 'OAUTH_AUTHORIZATION_DENIED',
      resourceType: 'Application',
      metadata: { result: 'DENIED', reasonCode, ...metadata },
      correlationId: this.context.traceId,
    });
  }
}
