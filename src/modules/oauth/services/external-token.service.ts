import { randomUUID } from 'crypto';
import jwt, { JwtHeader } from 'jsonwebtoken';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalTokenError } from '../errors';
import { ExternalTokenClaims, ExternalTokenSignInput } from '../interfaces';
import { SigningKeyService } from './signing-key.service';

/**
 * Phase 2D.1 (docs/adr/ADR-016-token-and-scope-model.md,
 * docs/adr/ADR-020-resource-server-authorization.md) — sign/verify the NEW
 * external, RS256-signed, `kid`-identified token type. This is the
 * "ExternalJwtVerifier" the Phase 2D.1 brief calls for: a structurally
 * separate class from the legacy `TokenService.verifyAccessToken()`
 * (HS256) — no shared code path, no ambiguous branching on `alg`
 * (docs/EXTERNAL_API_TRUST_BOUNDARY.md §0).
 *
 * No `/token`/`/authorize` endpoint calls `sign()` yet — this phase builds
 * only the cryptographic foundation those future endpoints will use
 * (docs/PHASE_2D_ARCHITECTURE.md §Implementation Roadmap, 2D.1). `sign()`
 * exists so this foundation is independently testable (round-trip
 * sign→verify) ahead of any endpoint existing to call it.
 */
@Injectable()
export class ExternalTokenService {
  private readonly issuer: string;
  private readonly defaultAudience: string;
  private readonly defaultTtlSeconds = 900;

  constructor(
    private readonly signingKeys: SigningKeyService,
    private readonly config: ConfigService,
  ) {
    this.issuer = this.config.get<string>('OAUTH_ISSUER') ?? 'identity-platform';
    this.defaultAudience = this.config.get<string>('OAUTH_AUDIENCE') ?? 'identity-platform-default';
  }

  /**
   * Phase 2D.4 — the single source of truth for the short-lived access-
   * token TTL every issuance path reports in its response (`expires_in`)
   * and relies on for `sign()`'s own default `expiresIn` above. Exposed as
   * a getter rather than duplicated as a second constant anywhere else
   * (brief §30: "do not introduce a second competing TTL configuration").
   */
  getDefaultTtlSeconds(): number {
    return this.defaultTtlSeconds;
  }

  /**
   * Signs a new external access token. `claims` never includes `iss`/`aud`/
   * `exp`/`iat`/`jti` — those are set here, from configuration and fresh
   * per-call values, exactly as `TokenService.signAccessToken()` already
   * does for the legacy token (never let a caller set claims that name the
   * signer's own authority or the token's own freshness).
   */
  sign(claims: ExternalTokenSignInput, options?: { audience?: string; expiresInSeconds?: number }): string {
    const { kid, privateKeyPem } = this.signingKeys.getSigningKey();
    return jwt.sign(claims, privateKeyPem, {
      algorithm: 'RS256',
      keyid: kid,
      issuer: this.issuer,
      audience: options?.audience ?? this.defaultAudience,
      expiresIn: options?.expiresInSeconds ?? this.defaultTtlSeconds,
      jwtid: randomUUID(),
    });
  }

  /**
   * Verifies an external token end to end: algorithm allow-list (RS256
   * only — never inferred from the token's own header alone), `kid`
   * resolution against this platform's own trusted key set, issuer,
   * audience, expiry, not-before. Throws a categorized `ExternalTokenError`
   * on any failure — never a raw jsonwebtoken error, and never logs or
   * echoes the token itself (docs/PHASE_2D_THREAT_MODEL.md §7, §8, §13, §14).
   *
   * `expectedAudience` lets a caller (a specific resource server, in a
   * future phase) require its OWN audience rather than this platform's
   * default — matching the "one token, one audience, no cross-product
   * acceptance" model (docs/EXTERNAL_API_TRUST_BOUNDARY.md §5).
   */
  verify(token: string, expectedAudience?: string): ExternalTokenClaims {
    const header = this.decodeHeaderOnly(token);

    // Pinned BEFORE any attempt to interpret the token's own signature —
    // never trust `header.alg` as authoritative on its own; this check
    // exists independently of (and in addition to) the `algorithms` option
    // passed to jwt.verify() below, which is the actual cryptographic
    // enforcement point (docs/PHASE_2D_THREAT_MODEL.md #7, algorithm confusion).
    if (header.alg !== 'RS256') {
      throw new ExternalTokenError('invalid_algorithm', `Unsupported algorithm in token header: ${header.alg}`);
    }
    if (!header.kid) {
      throw new ExternalTokenError('unknown_kid', 'Token header carries no kid');
    }

    const publicKeyPem = this.signingKeys.getPublicKeyForKid(header.kid);
    if (!publicKeyPem) {
      throw new ExternalTokenError('unknown_kid', `No trusted key for kid=${header.kid}`);
    }

    try {
      const verified = jwt.verify(token, publicKeyPem, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: expectedAudience ?? this.defaultAudience,
      });
      return verified as unknown as ExternalTokenClaims;
    } catch (err) {
      throw this.categorize(err);
    }
  }

  private decodeHeaderOnly(token: string): JwtHeader {
    let decoded: { header: JwtHeader; payload: unknown } | null;
    try {
      decoded = jwt.decode(token, { complete: true }) as { header: JwtHeader; payload: unknown } | null;
    } catch {
      decoded = null;
    }
    if (!decoded || !decoded.header) {
      throw new ExternalTokenError('invalid_token', 'Malformed token — could not decode header');
    }
    return decoded.header;
  }

  private categorize(err: unknown): ExternalTokenError {
    if (err instanceof jwt.TokenExpiredError) {
      return new ExternalTokenError('expired_token', 'Token has expired');
    }
    if (err instanceof jwt.NotBeforeError) {
      return new ExternalTokenError('not_yet_valid', 'Token is not yet valid (nbf)');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const message = err.message;
      if (message.includes('audience')) {
        return new ExternalTokenError('invalid_audience', 'Token audience does not match the expected resource');
      }
      if (message.includes('issuer')) {
        return new ExternalTokenError('invalid_issuer', 'Token issuer does not match this platform');
      }
      if (message.includes('algorithm')) {
        return new ExternalTokenError('invalid_algorithm', 'Token algorithm is not permitted');
      }
      return new ExternalTokenError('invalid_signature', 'Token signature is invalid');
    }
    return new ExternalTokenError('invalid_token', 'Token could not be verified');
  }
}
