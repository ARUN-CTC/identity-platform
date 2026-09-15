# Key Management Architecture

Detail document for ADR-017. Extends `docs/SECURITY_ARCHITECTURE.md` §2 (already-decided principles: private key never leaves the platform, overlap-window rotation) into a concrete design.

## 1. Algorithm

RS256 for the first asymmetric signing key (ADR-017's rationale: broadest cross-stack, cross-language compatibility for the very first key this platform ever publishes externally). ES256/EdDSA are the recommended choice for any *subsequent* key, once every consuming product has proven out `kid`/JWKS-driven verification rather than a hardcoded algorithm — a resource server that correctly implements this design never needs to change when the algorithm of a *new* key differs from an old one; it reads `alg` and `kid` from the token header and looks up accordingly.

## 2. `kid` (Key ID)

Every signing key is assigned a stable, opaque `kid` at creation (e.g. a UUID or a date-versioned string like `2026-09-key-1`) — included in every token's JWT header (`{"alg": "RS256", "kid": "2026-09-key-1"}`). A resource server's JWKS client selects the correct public key by `kid`, never by assuming "the current key" is the only valid one — this is precisely what makes overlapping-validity rotation (§4) possible without breaking in-flight tokens.

## 3. JWKS publication

`GET /.well-known/jwks.json` — publishes every **currently valid-for-verification** public key (the active signing key, plus any recently-retired key still within its overlap window), each with its own `kid`, in standard JWK format. Never publishes a private key. Cached by consuming products with a sane TTL (recommended: minutes, not seconds — this endpoint changes rarely) plus a background refresh; a resource server encountering an unrecognized `kid` should force an immediate cache refresh once (to handle a just-rotated key) before treating the token as invalid.

## 4. Rotation

- **Scheduled rotation** (e.g. quarterly, per `docs/SECURITY_ARCHITECTURE.md` §2, reaffirmed): a new keypair is generated, published to JWKS *before* it starts signing anything (so consuming products' caches have already picked it up), then becomes the active signing key.
- **Overlap window**: the previous key remains published in JWKS, marked non-current (signing has moved on), until every token it ever signed has naturally expired — bounded by the access-token TTL, which is exactly why that TTL is kept short (this is the same trade-off ADR-003 already accepted, now made load-bearing for key rotation specifically). Once the overlap window elapses, the old key is removed from JWKS entirely.
- **Emergency rotation** (suspected compromise): the same mechanism, run immediately rather than on schedule — the compromised key is retired from *signing* instantly, but must still remain in JWKS for validation until its overlap window elapses **unless** the compromise is severe enough to warrant accepting that tradeoff and force-invalidating everything it signed (an operational judgment call, documented as a runbook decision point, not a fixed rule).

## 5. Private key storage

Never leaves the Identity Platform's own process/secrets boundary — held in a secrets manager or equivalent (`docs/SECURITY_ARCHITECTURE.md` §4, Phase 2F's own carried-forward environment-hardening item), never in source control, never in an environment variable checked into any repository, never logged. Signing happens only inside the Identity Platform's own process.

## 6. Environment separation

Each environment (development, staging, production) has its own, entirely independent signing keypair — a development-signed token must never verify against a production JWKS endpoint or vice versa, which also means each environment naturally has its own `iss` value, providing a second, structural layer of cross-environment isolation beyond key separation alone.

## 7. Operational ownership

Key generation, rotation execution, and the emergency-rotation runbook are Identity-Platform-team-owned operations (never delegated to a product team) — consuming products only ever *read* JWKS; they never generate, rotate, or otherwise manage key material. This asymmetry is deliberate: it is what makes "private signing keys must never leave the Identity Platform" actually true rather than merely a policy statement.

## 8. Implementation status (Phase 2D.1, `docs/PHASE_2D1.md`)

**Built**: `SigningKeyService` (`src/modules/oauth/services/signing-key.service.ts`) implements §1–§3, §5 above — RSA keypair loading (`OAUTH_PRIVATE_KEY`) or, outside production, ephemeral generation at boot; a `kid` per key (explicit `OAUTH_KEY_ID` or a SHA-256-fingerprint default); `GET /.well-known/jwks.json` (`JwksController`), publishing only public key material — structurally, not just by omission, since every JWK is built from a `KeyObject` constructed from a public-key PEM, which cannot carry private fields at all. `OAUTH_RETIRED_PUBLIC_KEYS` gives §4's "overlap window" concept a working, config-driven mechanism (a previous key's public half stays published for verification without a database table) — the actual scheduled/emergency rotation *runbook* (§4, §7) remains a future operational procedure, not automated by this phase.

**Not built**: §6 (environment separation) is a deployment/configuration practice this document specifies but does not enforce in code — each environment's own `.env` simply needs its own `OAUTH_PRIVATE_KEY`. §7's secrets-manager integration (vs. a plain environment variable) remains Phase 2F's own carried-forward item. No `/authorize`/`/token`/`/userinfo`/`/revoke`/`/introspect` endpoint exists yet (`docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap, 2D.3+) — this phase built only the signing/verification/publication foundation those endpoints will use.

**`JWT_ACCESS_SECRET` was not retired** (Architecture Gate, Gate 1/10, ADR-017 as amended, confirmed unchanged by the actual implementation) — it remains the Identity Platform's own permanent, internal-only signing mechanism for the legacy proprietary token, hardened further in this phase by pinning `algorithms: ['HS256']` explicitly on both of its own verifiers (`TokenService.verifyAccessToken()`/`verifyPlatformAccessToken()`) so neither can ever be tricked into accepting the new RS256 token type — verified directly, `tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`.
