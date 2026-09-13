import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';
import { parseScopeClaim } from '../../../common';
import { GENERIC_INVALID_TOKEN_MESSAGE, ResourceServerAuthError, ResourceServerErrorReason } from '../errors';
import { AuthenticatedExternalPrincipal } from '../interfaces';
import { JwksClientService } from './jwks-client.service';

const DEFAULT_CLOCK_SKEW_SECONDS = 30;

/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md) — the Resource Server's
 * own external-token validator. Deliberately a SEPARATE implementation from
 * `ExternalTokenService.verify()` (Phase 2D.1): that service is coupled to
 * `SigningKeyService`, which also holds this platform's own PRIVATE signing
 * key — appropriate for the Identity Platform's own internal round-trip
 * tests, wrong for a component modeling what an actually-separate resource
 * server does. This class depends only on `JwksClientService` (public key
 * material fetched over HTTP, never the signing service) — see that
 * class's own doc comment for the full "structural, not conventional"
 * reasoning.
 *
 * What IS reused, not duplicated: the underlying cryptographic library
 * (`jsonwebtoken`, already a direct dependency since Phase 2D.1) and the
 * exact validation shape (algorithm pin → kid → signature → issuer →
 * audience → temporal → required claims) `ExternalTokenService.verify()`
 * already established — this class is a second, correctly-scoped WIRING
 * of that same proven shape against a different (HTTP-fetched, not
 * in-process) key source, not a competing cryptographic implementation.
 *
 * Never performs a database lookup — the validated token's own claims ARE
 * the principal (brief §40: "no database lookups on every JWT validation").
 */
@Injectable()
export class ExternalAccessTokenValidator {
  private readonly logger = new Logger(ExternalAccessTokenValidator.name);
  private readonly issuer: string;
  private readonly clockToleranceSeconds: number;

  constructor(
    private readonly jwks: JwksClientService,
    private readonly config: ConfigService,
  ) {
    this.issuer = this.config.get<string>('OAUTH_ISSUER') ?? 'identity-platform';
    this.clockToleranceSeconds = Number(this.config.get<string>('OAUTH_CLOCK_SKEW_SECONDS') ?? String(DEFAULT_CLOCK_SKEW_SECONDS));
  }

  async validate(token: string, expectedAudience: string): Promise<AuthenticatedExternalPrincipal> {
    const header = this.decodeHeader(token);

    // Pinned BEFORE any attempt to use the token's own signature —
    // `header.alg` is compared to a constant, never used to select or
    // negotiate a verification algorithm (brief §4: "never attempt
    // algorithm negotiation based on token input"; threat #2/#3 alg=none /
    // algorithm confusion).
    if (header.alg !== 'RS256') {
      this.logDenial('unsupported_algorithm', { alg: header.alg });
      throw new ResourceServerAuthError('invalid_token', 'unsupported_algorithm', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    if (!header.kid || typeof header.kid !== 'string') {
      this.logDenial('missing_kid', {});
      throw new ResourceServerAuthError('invalid_token', 'missing_kid', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    const publicKeyPem = await this.jwks.getPublicKeyForKid(header.kid);
    if (!publicKeyPem) {
      this.logDenial('unknown_kid', { kid: header.kid });
      throw new ResourceServerAuthError('invalid_token', 'unknown_kid', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    let payload: JwtPayload;
    try {
      // Signature verification is unconditional and non-optional here —
      // reaching this line never itself grants trust; `jwt.verify` is what
      // actually proves the signature, issuer, audience, and temporal
      // claims, all in one call, never separated into a "check signature"
      // step that could be skipped independently of the others.
      payload = jwt.verify(token, publicKeyPem, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: expectedAudience,
        clockTolerance: this.clockToleranceSeconds,
      }) as JwtPayload;
    } catch (err) {
      throw this.categorize(err);
    }

    return this.constructPrincipal(payload, header.kid, expectedAudience);
  }

  private decodeHeader(token: string): JwtHeader {
    let decoded: { header: JwtHeader; payload: unknown } | null;
    try {
      decoded = jwt.decode(token, { complete: true }) as { header: JwtHeader; payload: unknown } | null;
    } catch {
      decoded = null;
    }
    if (!decoded || !decoded.header) {
      this.logDenial('malformed_token', {});
      throw new ResourceServerAuthError('invalid_token', 'malformed_token', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    return decoded.header;
  }

  private constructPrincipal(payload: JwtPayload, kid: string, expectedAudience: string): AuthenticatedExternalPrincipal {
    // Phase 2D.8 (docs/OIDC_PROVIDER.md §2, brief §26-28, Invariant 10) —
    // checked FIRST, before any other claim is even read: an OIDC ID Token
    // (`IdTokenService.sign()` always sets `token_use: 'id_token'`) must
    // never be usable as a bearer access token, by construction, not
    // merely because it happens to lack `tenant_id`/`jti` (though it does).
    // A Client-Credentials/Authorization-Code Access Token never carries
    // this value at all (`token_use` is absent, or explicitly
    // `'access_token'` since Phase 2D.8's own `AuthorizationCodeGrantService`
    // update) — only an ID Token sets it to `'id_token'`.
    if (this.optionalStringClaim(payload, 'token_use') === 'id_token') {
      this.logDenial('id_token_not_accepted', {});
      throw new ResourceServerAuthError('invalid_token', 'id_token_not_accepted', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    const subject = this.requireStringClaim(payload, 'sub');
    const clientId = this.requireStringClaim(payload, 'client_id');
    const tenantId = this.requireStringClaim(payload, 'tenant_id');
    const jti = this.requireStringClaim(payload, 'jti');
    // Present-if-requested only (Phase 2D.4 omits the claim entirely when
    // no scope was requested — see docs/PHASE_2D4.md) — absence means "no
    // scopes granted," never "all scopes."
    const rawScope = this.optionalStringClaim(payload, 'scope');
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
      this.logDenial('malformed_claim', { claim: 'iat/exp' });
      throw new ResourceServerAuthError('invalid_token', 'malformed_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    // Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §15) — an explicit
    // claim, never guessed from the shape of `sub`. Absence means
    // SERVICE_ACCOUNT (every Client Credentials token issued before this
    // claim existed, and every one Phase 2D.4's own ClientCredentialsService
    // still signs today, omits it — this default is what keeps that
    // unchanged) — a present value must be one of the two known types,
    // never silently accepted otherwise.
    const rawPrincipalType = this.optionalStringClaim(payload, 'principal_type');
    if (rawPrincipalType !== undefined && rawPrincipalType !== 'USER' && rawPrincipalType !== 'SERVICE_ACCOUNT') {
      this.logDenial('malformed_claim', { claim: 'principal_type' });
      throw new ResourceServerAuthError('invalid_token', 'malformed_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    const type: 'USER' | 'SERVICE_ACCOUNT' = rawPrincipalType === 'USER' ? 'USER' : 'SERVICE_ACCOUNT';

    const rawOrganizationId = this.optionalStringClaim(payload, 'organization_id');

    this.logger.log(`external_auth_success type=${type} client_id=${clientId} tenant_id=${tenantId} jti=${jti} kid=${kid} aud=${expectedAudience}`);

    return {
      type,
      subject,
      serviceAccountId: type === 'SERVICE_ACCOUNT' ? subject : undefined,
      userId: type === 'USER' ? subject : undefined,
      clientId,
      tenantId,
      organizationId: type === 'USER' ? (rawOrganizationId ?? null) : undefined,
      audience: expectedAudience, // the verified value — jwt.verify already proved the token's own aud matches this
      scopes: parseScopeClaim(rawScope),
      jti,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      notBefore: typeof payload.nbf === 'number' ? new Date(payload.nbf * 1000) : undefined,
      issuer: this.issuer, // verified equal to payload.iss by jwt.verify above
    };
  }

  private requireStringClaim(payload: JwtPayload, key: string): string {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.length === 0) {
      this.logDenial('missing_required_claim', { claim: key });
      throw new ResourceServerAuthError('invalid_token', 'missing_required_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    return value;
  }

  private optionalStringClaim(payload: JwtPayload, key: string): string | undefined {
    const value = (payload as Record<string, unknown>)[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      this.logDenial('malformed_claim', { claim: key });
      throw new ResourceServerAuthError('invalid_token', 'malformed_claim', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    return value;
  }

  private categorize(err: unknown): ResourceServerAuthError {
    if (err instanceof jwt.TokenExpiredError) {
      this.logDenial('expired_token', {});
      return new ResourceServerAuthError('invalid_token', 'expired_token', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    if (err instanceof jwt.NotBeforeError) {
      this.logDenial('not_yet_valid', {});
      return new ResourceServerAuthError('invalid_token', 'not_yet_valid', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const message = err.message;
      if (message.includes('audience')) {
        this.logDenial('invalid_audience', {});
        return new ResourceServerAuthError('invalid_token', 'invalid_audience', GENERIC_INVALID_TOKEN_MESSAGE);
      }
      if (message.includes('issuer')) {
        this.logDenial('invalid_issuer', {});
        return new ResourceServerAuthError('invalid_token', 'invalid_issuer', GENERIC_INVALID_TOKEN_MESSAGE);
      }
      if (message.includes('algorithm')) {
        this.logDenial('unsupported_algorithm', {});
        return new ResourceServerAuthError('invalid_token', 'unsupported_algorithm', GENERIC_INVALID_TOKEN_MESSAGE);
      }
      this.logDenial('invalid_signature', {});
      return new ResourceServerAuthError('invalid_token', 'invalid_signature', GENERIC_INVALID_TOKEN_MESSAGE);
    }
    this.logDenial('invalid_signature', {});
    return new ResourceServerAuthError('invalid_token', 'invalid_signature', GENERIC_INVALID_TOKEN_MESSAGE);
  }

  /** Structured, safe logging only — never the token, never a claim's own secret-adjacent value (there are none in this claim set, but this stays true even if a future claim were added). */
  private logDenial(reason: ResourceServerErrorReason, context: Record<string, unknown>): void {
    this.logger.warn(`external_auth_denied reason=${reason} ${JSON.stringify(context)}`);
  }
}
