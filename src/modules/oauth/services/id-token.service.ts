import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { IdTokenSignInput } from '../interfaces';
import { ExternalTokenService } from './external-token.service';
import { SigningKeyService } from './signing-key.service';

/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §7-9, brief §11) — a narrowly scoped,
 * ISSUANCE-ONLY OIDC ID Token service. A distinct class from
 * `ExternalTokenService` — not a modification of it — because the two
 * artifacts have genuinely different semantics that the brief itself
 * explicitly warns against blurring (brief §11/§13: "Do not duplicate
 * cryptographic key management" but also "do not blindly copy Resource
 * Server Access Token claims into the ID Token"). This class threads that
 * needle by reusing the IDENTICAL key material and signing primitives
 * (`SigningKeyService.getSigningKey()`, the same `jsonwebtoken` library,
 * the same RS256/`kid` mechanism) while defining its own claim shape and
 * its own `aud` semantics (the requesting OIDC client's `clientId`, never a
 * resource-API audience — brief §14, the single most important rule in
 * this phase).
 *
 * No ID Token is ever verified by this platform itself — an ID Token is
 * consumed by the requesting OIDC Client, external to this codebase (this
 * platform is the OP, not an RP) — so this class deliberately has no
 * `verify()` method; `tests/phase2d8-oidc-provider.e2e-spec.ts` proves
 * verifiability independently, the same way `tests/phase2d4-*`/
 * `tests/phase2d7-*` already prove Access Token verifiability: fetch the
 * real JWKS over HTTP and verify with `jsonwebtoken` directly, in the test,
 * never via this platform's own code (brief §58).
 *
 * Reuses `ExternalTokenService.getDefaultTtlSeconds()` rather than
 * introducing a second, competing TTL configuration (the same "single
 * source of truth" discipline that getter's own doc comment already
 * established) — an ID Token's lifetime matches the Access Token issued in
 * the same transaction.
 */
@Injectable()
export class IdTokenService {
  private readonly issuer: string;

  constructor(
    private readonly signingKeys: SigningKeyService,
    private readonly externalTokens: ExternalTokenService,
    private readonly config: ConfigService,
  ) {
    this.issuer = this.config.get<string>('OAUTH_ISSUER') ?? 'identity-platform';
  }

  /**
   * `claims.aud` MUST be the requesting OIDC client's own `Application.clientId`
   * — never a resource-server audience (brief §14/§15, Invariant 2). Callers
   * (`AuthorizationCodeGrantService`) are responsible for passing it
   * correctly; this service does not itself look up or validate the client.
   */
  sign(claims: IdTokenSignInput): string {
    const { kid, privateKeyPem } = this.signingKeys.getSigningKey();
    // `aud` is deliberately excluded from the payload object and passed
    // instead as jsonwebtoken's own `audience` sign option — the same
    // "never let a caller-shaped object also carry a claim the signer
    // itself sets" discipline `ExternalTokenService.sign()` already
    // follows for `aud`/`iss`/`exp`/`iat`/`jti`.
    const { aud, ...rest } = claims;
    const payload = { ...rest, token_use: 'id_token' as const };

    return jwt.sign(payload, privateKeyPem, {
      algorithm: 'RS256',
      keyid: kid,
      issuer: this.issuer,
      audience: aud,
      expiresIn: this.externalTokens.getDefaultTtlSeconds(),
    });
  }
}
