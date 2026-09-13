import { Injectable } from '@nestjs/common';
import { verifyClientSecret } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { ApplicationsRepository } from '../../applications/repositories';
import { UsersService } from '../../users/services';
import { TokenService } from '../../jwt/services';
import { OPENID_SCOPE } from '../constants/oidc.constants';
import { OAuthTokenError } from '../errors';
import { AuthorizationCodesRepository } from '../repositories';
import { isValidCodeVerifierFormat, mapOidcUserClaims, verifyCodeVerifier } from '../utils';
import { ExternalTokenService } from './external-token.service';
import { IdTokenService } from './id-token.service';

/** Raw, unvalidated request shape — every field optional; this service itself validates. */
export interface AuthorizationCodeGrantRequest {
  clientId?: string;
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
}

export interface AuthorizationCodeGrantResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope?: string;
  /** Phase 2D.8 — present ONLY when the original authorization request included `openid` (brief §31, Invariant 4/5). Never present for an ordinary OAuth-only transaction. */
  idToken?: string;
}

/**
 * Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md) — `POST /oauth/token`,
 * `grant_type=authorization_code`. Structurally parallel to, but never
 * sharing a code path with, `ClientCredentialsService` (Phase 2D.4,
 * completely unchanged by this phase — brief §55) — this is the SECOND
 * grant handler the token endpoint's controller now routes to, never a
 * modification of the first.
 *
 * Every step below fails closed with the generic `invalid_client` (client
 * authentication) or `invalid_grant` (anything about the code itself) —
 * never distinguishing "code not found" from "already used" from "wrong
 * client" from "expired" from "bad PKCE verifier" in the response body
 * (brief §40/§43); the specific reason is recorded only in the (never
 * client-visible) audit metadata, exactly the discipline
 * `ClientCredentialsService.deny()` already established.
 *
 * The critical transaction boundary (brief §48/§49/Invariant 19): every
 * binding check (client/redirect_uri/PKCE/expiry/already-consumed) runs
 * against a plain read FIRST; only after every check passes does
 * `AuthorizationCodesRepository.tryConsume()` — the one atomic, concurrency
 * -safe compare-and-swap UPDATE — run, and ONLY if THAT succeeds is a token
 * ever signed. Consumption is committed before signing, never after —
 * signing is a pure in-memory RS256 operation that cannot itself fail in a
 * way that would need to "give back" an already-consumed code, so there is
 * no window in which a signing failure could leave a code both consumed
 * and unredeemed-in-practice (which would otherwise invite a legitimate-
 * looking retry that this class would then wrongly deny).
 */
@Injectable()
export class AuthorizationCodeGrantService {
  constructor(
    private readonly applications: ApplicationsRepository,
    private readonly authorizationCodes: AuthorizationCodesRepository,
    private readonly tokenService: TokenService,
    private readonly externalTokens: ExternalTokenService,
    private readonly idTokens: IdTokenService,
    private readonly usersService: UsersService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async issueToken(basicAuth: { clientId: string; clientSecret: string } | null, request: AuthorizationCodeGrantRequest): Promise<AuthorizationCodeGrantResult> {
    if (!request.code || !request.redirectUri || !request.codeVerifier) {
      throw await this.deny(undefined, 'invalid_request', 'code, redirect_uri, and code_verifier are required', { reasonCode: 'missing_required_parameter' });
    }
    if (!isValidCodeVerifierFormat(request.codeVerifier)) {
      throw await this.deny(undefined, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'malformed_code_verifier' });
    }

    // --- 1. Client authentication (brief §29/§30, threats #32/#41) -------
    // A Basic header present ALWAYS means "authenticate as a confidential
    // client" — a CONFIDENTIAL Application can never downgrade itself to
    // `none` auth merely by omitting the header (that would let a stolen
    // client_id alone, with no secret, pass as a public client).
    let application;
    if (basicAuth) {
      const found = await this.applications.findByClientId(basicAuth.clientId);
      if (!found || found.tokenEndpointAuthMethod !== 'client_secret_basic' || !verifyClientSecret(basicAuth.clientSecret, found.clientSecretHash) || found.status !== 'ACTIVE') {
        throw await this.deny(undefined, 'invalid_client', 'Client authentication failed', {
          reasonCode: !found
            ? 'client_not_found'
            : found.tokenEndpointAuthMethod !== 'client_secret_basic'
              ? 'client_auth_method_not_supported'
              : found.status !== 'ACTIVE'
                ? 'application_inactive'
                : 'invalid_client_secret',
          clientId: basicAuth.clientId,
        });
      }
      application = found;
    } else {
      if (!request.clientId) {
        throw await this.deny(undefined, 'invalid_client', 'Client authentication failed', { reasonCode: 'missing_client_id' });
      }
      const found = await this.applications.findByClientId(request.clientId);
      if (!found || found.tokenEndpointAuthMethod !== 'none' || found.status !== 'ACTIVE') {
        throw await this.deny(undefined, 'invalid_client', 'Client authentication failed', {
          reasonCode: !found ? 'client_not_found' : found.tokenEndpointAuthMethod !== 'none' ? 'client_requires_authentication' : 'application_inactive',
          clientId: request.clientId,
        });
      }
      application = found;
    }
    if (!application.grantTypes.includes('authorization_code')) {
      throw await this.deny(undefined, 'unauthorized_client', 'This application is not authorized for the authorization_code grant', { applicationId: application.id });
    }

    // --- 2. Parse + look up the code (brief §30, threats #17/#20) ---------
    const parsed = this.tokenService.parseAuthorizationCode(request.code);
    if (!parsed) {
      throw await this.deny(undefined, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'malformed_code', applicationId: application.id });
    }
    const codeHash = this.tokenService.hashAuthorizationCode(parsed.secret);
    const row = await this.authorizationCodes.findByCodeHash(parsed.tenantId, codeHash);
    if (!row) {
      throw await this.deny(parsed.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'code_not_found', applicationId: application.id });
    }

    // --- 3. Binding checks BEFORE consuming (brief §13/§30/§31, threats #14-16,19-23,42) ---
    if (row.applicationId !== application.id) {
      throw await this.deny(row.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'code_client_mismatch', applicationId: application.id, userId: row.userId });
    }
    if (row.redirectUri !== request.redirectUri) {
      throw await this.deny(row.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'code_redirect_uri_mismatch', applicationId: application.id, userId: row.userId });
    }
    if (row.consumedAt) {
      throw await this.deny(
        row.tenantId,
        'invalid_grant',
        'The authorization grant is invalid',
        { reasonCode: 'code_already_consumed', applicationId: application.id, userId: row.userId },
        'OAUTH_AUTHORIZATION_CODE_REPLAYED',
      );
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw await this.deny(row.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'code_expired', applicationId: application.id, userId: row.userId });
    }
    if (row.codeChallengeMethod !== 'S256' || !verifyCodeVerifier(request.codeVerifier, row.codeChallenge)) {
      throw await this.deny(row.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'pkce_verification_failed', applicationId: application.id, userId: row.userId });
    }

    // --- 4. Atomic consume — the actual replay-protection gate (brief §18/§48) ---
    const consumed = await this.authorizationCodes.tryConsume(row.tenantId, codeHash);
    if (!consumed) {
      // Lost the race to a concurrent redeemer of the SAME code (or it
      // expired/was consumed in the instant between the read above and this
      // write) — audited as a replay attempt either way, never distinguished
      // in the response.
      throw await this.deny(
        row.tenantId,
        'invalid_grant',
        'The authorization grant is invalid',
        { reasonCode: 'code_consume_race_lost', applicationId: application.id, userId: row.userId },
        'OAUTH_AUTHORIZATION_CODE_REPLAYED',
      );
    }

    // --- 5. Sign the human access token (brief §32-34) --------------------
    const scope = row.scopes.length > 0 ? row.scopes.join(' ') : undefined;
    const accessToken = this.externalTokens.sign(
      {
        sub: row.userId, // security_user.id — never ServiceAccount.id, never Application.id (brief §20)
        client_id: application.clientId,
        tenant_id: row.tenantId,
        organization_id: row.organizationId ?? undefined, // omitted (never null) when tenant-wide — see ExternalAccessTokenValidator's own optionalStringClaim handling
        scope,
        principal_type: 'USER', // brief §33 — explicit, never inferred from `sub`'s shape
        token_use: 'access_token', // Phase 2D.8 — explicit token-purpose discriminator (brief §28), distinct from the ID Token issued below
      },
      { audience: row.audience }, // the code's own stored audience — never re-requested at /token (brief §38)
    );
    const expiresIn = this.externalTokens.getDefaultTtlSeconds();

    // No refresh_token (brief §35/§50): the existing SecurityRefreshToken
    // system is tightly bound to the legacy HS256 SecuritySession model
    // (rotation/reuse-detection keyed on session_id) and is not safely
    // reusable for an RS256 external OAuth token with no SecuritySession of
    // its own — building a SECOND, parallel refresh-token implementation is
    // exactly what brief §35 forbids ("do not create a second refresh-token
    // implementation"). Deferred and documented
    // (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §Known limitations).

    // --- 6. ID Token — ONLY if the ORIGINAL /authorize request included
    // `openid` (brief §31/Invariant 4/5: "do not issue an ID Token if the
    // original authorization request did not request openid"; the token
    // request itself has no `openid`/`nonce` of its own to add after the
    // fact — the authorization code, already atomically consumed above, is
    // the sole and authoritative record of what was actually requested,
    // brief §30). `row.nonce` is non-null exactly when `openid` was
    // requested (AuthorizeService's own invariant) — both are checked as
    // defense in depth against either ever silently drifting from the other.
    let idToken: string | undefined;
    if (row.scopes.includes(OPENID_SCOPE) && row.nonce) {
      // `findGlobalById` — no ambient tenant context exists at `/token`
      // (this endpoint is `@Public()`, never behind `JwtAuthGuard`), and the
      // code's own issuance (`AuthorizeService`, Phase 2D.7) already
      // independently verified tenant/membership validity; re-deriving that
      // here would be a second, redundant live-membership check, not a new
      // invariant this phase needs to introduce. Sanitized (no
      // passwordHash), matching every other read of this row.
      const user = await this.usersService.findGlobalById(row.userId);
      if (!user) {
        // Exceptionally rare (the user row was deleted between issuance and
        // exchange) — fails the WHOLE exchange closed rather than silently
        // issuing an ID Token with no user claims at all.
        throw await this.deny(row.tenantId, 'invalid_grant', 'The authorization grant is invalid', { reasonCode: 'user_not_found', applicationId: application.id, userId: row.userId });
      }
      const oidcClaims = mapOidcUserClaims(
        { id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email, emailVerifiedAt: user.emailVerifiedAt },
        row.scopes,
      );
      idToken = this.idTokens.sign({
        ...oidcClaims,
        aud: application.clientId, // the REQUESTING OIDC CLIENT — never row.audience (brief §14/§15, Invariant 2)
        nonce: row.nonce, // the client's own original nonce, unmodified (brief §8, Invariant 7)
      });
    }

    await this.securityEvents.record({
      tenantId: row.tenantId,
      actorUserId: row.userId,
      eventType: idToken ? 'OIDC_ID_TOKEN_ISSUED' : 'OAUTH_AUTHORIZATION_CODE_REDEEMED',
      resourceType: 'Application',
      resourceId: application.id,
      metadata: {
        result: 'SUCCESS',
        applicationId: application.id,
        userId: row.userId,
        audience: row.audience,
        scopes: row.scopes,
        organizationId: row.organizationId,
        oidc: Boolean(idToken),
      },
    });

    return { accessToken, tokenType: 'Bearer', expiresIn, scope, idToken };
  }

  /**
   * Records a denial audit event (never a secret/credential/token/authorization
   * code/private key, brief §44) and returns the corresponding OAuth-shaped
   * error. `tenantId` is `undefined` only for the handful of failures that
   * happen before ANY tenant is known (missing parameters, an unparseable
   * code) — those are recorded as a PLATFORM-scope event instead, never
   * faked with a tenantId that was never actually established (mirrors
   * `docs/PLATFORM_OPERATOR_ARCHITECTURE.md`'s own "platform events never
   * carry a tenantId" invariant).
   */
  private async deny(
    tenantId: string | undefined,
    code: OAuthTokenError['code'],
    description: string,
    metadata: Record<string, unknown>,
    eventType: 'OAUTH_AUTHORIZATION_CODE_DENIED' | 'OAUTH_AUTHORIZATION_CODE_REPLAYED' = 'OAUTH_AUTHORIZATION_CODE_DENIED',
  ): Promise<OAuthTokenError> {
    const resourceId = typeof metadata.applicationId === 'string' ? metadata.applicationId : undefined;
    const actorUserId = typeof metadata.userId === 'string' ? metadata.userId : undefined;
    if (tenantId) {
      await this.securityEvents.record({ tenantId, actorUserId, eventType, resourceType: 'Application', resourceId, metadata: { result: 'DENIED', ...metadata } });
    } else {
      await this.securityEvents.recordPlatformEvent({ eventType, resourceType: 'Application', resourceId, metadata: { result: 'DENIED', ...metadata } });
    }
    return new OAuthTokenError(code, description);
  }
}
