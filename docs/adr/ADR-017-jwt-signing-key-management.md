# ADR-017: JWT Signing Algorithm and Key Management

## Context

ADR-003 already decided asymmetric signing (RS256/EdDSA) over a shared symmetric secret. **The actual Phase 1–2C implementation still signs with HS256** (`NestJwtModule.registerAsync({ secret: JWT_ACCESS_SECRET })`, `src/modules/jwt/jwt.module.ts`) — a deliberate, self-documented interim state (`token.service.ts`: *"same signing secret (HS256, unchanged — ADR-003 still governs any future move to asymmetric per-audience keys)"*), not an accidental deviation. This ADR is the conflict this document is required to surface explicitly: **ADR-003's decision (asymmetric) and the current runtime (symmetric HS256) genuinely disagree today.** This ADR does not reverse ADR-003 — it re-affirms it and specifies exactly how and when the migration happens, since Phase 2D is architecture only.

## Problem

A single symmetric secret shared with every verifying party is a credential every one of those parties must protect equally well — the moment a second, independently-operated resource server (any product other than the Identity Platform's own backend) needs to verify a token locally, that secret would have to be distributed to it, and a compromise anywhere becomes a forgeable-token-anywhere problem. This has been tolerable only because, through Phase 2C, no product has yet needed to verify a token independently of the Identity Platform itself.

## Options

1. **Stay on HS256 indefinitely**, distribute the shared secret to every product that needs local verification. Rejected outright the moment more than one independently-operated verifier exists — single point of total compromise, no per-product key isolation, no revocation of one verifier's trust without rotating everyone's.
2. **RS256** (RSA, PKCS#1 v1.5). Widely supported by every JWT/JOSE library and every OIDC relying-party library; larger signatures/keys (2048+-bit RSA) than EC alternatives.
3. **ES256** (ECDSA P-256). Smaller signatures and keys than RSA at equivalent security margins; slightly less universal legacy-library support than RSA but well within any current mainstream stack (Node, .NET, Java, Python, Go).
4. **EdDSA (Ed25519)**. Strongest modern choice (simpler, misuse-resistant implementation profile, fast), but support in some older OIDC relying-party libraries and some enterprise IdP-integration tooling lags RSA/ECDSA.

## Decision

**Migrate from HS256 to RS256** as the primary signing algorithm, with the JWKS endpoint (`docs/KEY_MANAGEMENT_ARCHITECTURE.md`) designed from day one to publish `alg`/`kid` per key so a future move to ES256/EdDSA for new keys is additive (a resource server that correctly implements JWKS-based verification never hardcodes an algorithm) rather than another migration. RS256 is chosen over ES256/EdDSA specifically for this first migration because it has the broadest possible compatibility across three independently-built, independently-deployed products whose technology stacks and library maturity are not fully known in advance — the safest common denominator for an inaugural asymmetric rollout. ES256/EdDSA remain the recommended choice for any *new* signing key introduced after this migration, once every consuming product has proven out JWKS-based (not hardcoded-algorithm) verification.

## Rationale

RS256 is supported by essentially every JWT library in every mainstream language without exception, which matters most for the very first asymmetric key this platform ever publishes — a compatibility failure discovered after the fact would force an emergency rollback across every product simultaneously. Requiring `kid`-driven, JWKS-based key lookup (not a hardcoded public key or algorithm) in every resource server from the start is what makes every *later* algorithm change (to ES256/EdDSA, or a routine rotation) a non-event rather than a coordinated multi-product migration — this is the actual lesson of ADR-003's own risk callout ("key management becomes genuinely load-bearing infrastructure").

## Security implications

The private key never leaves the Identity Platform's own process/secrets boundary — full lifecycle in `docs/KEY_MANAGEMENT_ARCHITECTURE.md`. Overlapping-validity rotation (old key stays published, marked non-current, until every token it signed has naturally expired — bounded by the short access-token TTL) is reaffirmed from `docs/SECURITY_ARCHITECTURE.md` §2, now made a hard architectural requirement rather than a recommendation, since more than one independent verifier now depends on it.

## Operational implications

`JWT_ACCESS_SECRET` (a single env-var symmetric secret) is superseded by a private/public keypair with an operational owner and a documented rotation runbook (`docs/KEY_MANAGEMENT_ARCHITECTURE.md` §Operational ownership) — a genuine new operational responsibility this platform did not carry before, accepted as the necessary cost of a second independent verifier existing at all.

## Consequences

Every resource server built against this platform from Phase 2D's design forward must implement JWKS-based verification (fetch `/.well-known/jwks.json`, cache with a sane TTL, select by `kid`) — never a hardcoded public key or algorithm — this is stated as a hard requirement for any product onboarding after this ADR, the same way `aud` validation already is (ADR-003).

## Deferred considerations

The actual migration (issuing an RSA keypair, standing up `/.well-known/jwks.json`, cutting the signing path over, retiring `JWT_ACCESS_SECRET`) is **not performed in Phase 2D** — it is sequenced as an early implementation sub-phase (`docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap, 2D.2) once Phase 2D's design is approved. Until that migration ships, the existing HS256 token remains the Identity Platform's only signing mechanism and continues to work exactly as it does today (§Backward Compatibility, same document).

## Gate Review Amendment (Phase 2D Architecture Gate — Gate 1)

**This amendment refines "retiring `JWT_ACCESS_SECRET`" above — on re-examination, the legacy proprietary token should never actually need to be retired.** The Decision above was framed as an eventual full cutover ("RS256 as the primary signing algorithm" implying every token, eventually, including the existing proprietary one). Re-examined against the actual reason ADR-003/this ADR's own Problem statement exists — *"the moment a second, independently-operated resource server needs to verify a token locally"* — that condition is true **only for OAuth/OIDC-issued tokens**, which by design are handed to external, independently-operated resource servers. The existing proprietary token is, and after any future OAuth/OIDC implementation will remain, verified **exclusively by the Identity Platform's own `JwtAuthGuard`, in the same process/trust boundary that issues it** — no product, no external resource server, ever receives `JWT_ACCESS_SECRET` or attempts to verify that token independently. A symmetric secret shared only within one trust boundary is not the problem this ADR exists to solve.

**Revised decision: Option A — permanent, by-design coexistence of both algorithms, scoped by token purpose, not a migration of one into the other:**

```text
HS256 (JWT_ACCESS_SECRET)  →  the existing proprietary bearer token
                               (Phase 1-2C login/refresh/context-switch) —
                               verified ONLY by this platform's own
                               JwtAuthGuard. Retained PERMANENTLY, not as
                               a transitional legacy state.

RS256 (JWKS-published)     →  NEW: any OAuth/OIDC-issued token (human
                               authorization_code, service client_credentials)
                               — verified independently by external resource
                               servers. This is the ONLY token type this
                               phase's asymmetric-signing decision governs.
```

No existing session, refresh token, or API contract is affected by this at all — there is no cutover, no deprecation timeline, and no forced re-signing of anything, because nothing about the existing token type changes. "Migration" (Gate 10, `docs/PHASE_2D_ARCHITECTURE.md` §5) is therefore purely **additive infrastructure standup** (a new keypair, a new JWKS endpoint, a new issuance path for a new token type) — not a cutover of an existing one. This is a strictly smaller, equally-secure design than the original framing, consistent with the gate review's own simplification rule: do not migrate something that was never actually exposed to the risk the migration exists to close.

**Structural (not just conventional) separation, resolving Gate 2**: because the two token types are verified via cryptographically incompatible mechanisms — `JwtAuthGuard` holds only the HS256 secret and cannot verify an RS256-signed token even by mistake (a correctly-configured verifier pins its expected algorithm and never infers it from the token's own header — this is the standard, mandatory defense against the "algorithm confusion" attack, `docs/PHASE_2D_THREAT_MODEL.md` #7); an external resource server, conversely, is never given `JWT_ACCESS_SECRET` and so cannot verify an HS256-signed legacy token even if one were somehow presented to it — a legacy token and an OAuth/OIDC token are *structurally* incapable of being cross-accepted, not merely discouraged from it by convention. This is reinforced, in depth, by `alg` (HS256 vs RS256, visible in the JWT header), by `aud` (the legacy token has no `aud`, or a reserved self-referential value; every OAuth/OIDC token has a real, mandatory, resource-API-specific `aud`), and by `kid` (present only on RS256 tokens, since only they are looked up via JWKS).
