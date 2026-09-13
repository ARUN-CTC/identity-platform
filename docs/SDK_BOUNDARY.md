# SDK Boundary

Phase 2D.10 (brief §17) — defines the boundary a FUTURE product-facing SDK must respect. **No SDK is built in this phase** — this document, plus `src/contracts/` (its TypeScript design source, in-process only), is the boundary definition itself.

## 1. Why no SDK yet

A real SDK is only worth building once at least one real, separately-deployed product actually needs it — building one speculatively risks guessing wrong about the consuming language/framework/deployment shape. Today, every consumer of this platform's OAuth/OIDC/resource-server contract is this repository's own test suite (`tests/phase2d5-*`, `tests/phase2d6-*`, `tests/phase2d10-*`). `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` is written to be implementable by an SDK in ANY language — that document, not this platform's own TypeScript, is the actual portable contract.

## 2. Future SDK responsibilities (brief §17)

A future SDK (per-language: Node, Python, Go, .NET, ...) must provide:

```text
JWT validation           — algorithm-pinned (RS256 only), kid required, unknown kid fails closed
JWKS discovery/cache      — fetch from a configured jwks_uri, cache by kid, cooldown-bounded refresh
                            on cache miss, tolerate a temporary JWKS outage for an already-cached key
principal extraction      — the IdentityPrincipal shape (docs/IDENTITY_EXTERNAL_API_CONTRACT.md §3)
tenant context             — expose principal.tenantId as the ONLY authoritative tenant; never let a
                            request header override it
scope helpers             — requireScope/hasScope-equivalent, product-neutral
authorization helpers      — a pluggable policy seam equivalent to ResourceAuthorizationPolicy
                            (docs/RESOURCE_AUTHORIZATION_CONTRACT.md) — the SDK ships the seam, never
                            a policy implementation
correlation propagation    — read/forward a request correlation id (docs/OAUTH_OPERATIONAL_HARDENING.md
                            §Request correlation) into the product's own logs
standard error mapping     — IdentityBearerErrorCode -> the product's own idiomatic error/exception type,
                            preserving the 401-vs-403 distinction (docs/IDENTITY_EXTERNAL_API_CONTRACT.md §6)
```

This is exactly what `src/modules/resource-server/` already implements, in TypeScript, for THIS repository's own in-process test/demo use (`ResourceServerDemoController`) — a future SDK is that same reference pattern, re-implemented for a genuinely separate process/language, not a new design.

## 3. What an SDK must NEVER do

```text
- access the Identity Platform's database (Prisma or otherwise) directly
- contain any product's business logic, IAM roles, or permission names
- bypass ProductAccessService-equivalent entitlement checks by caching "allowed" past a token's own expiry
- bypass audience validation, or accept an unspecified/wildcard audience
- accept an ID Token as an API bearer credential
- log a bearer token, client secret, service-account secret, PKCE verifier, nonce, or private key
```

Every one of these mirrors an invariant this platform's own reference implementation already enforces (`docs/RESOURCE_SERVER_ARCHITECTURE.md`, `docs/OAUTH_OPERATIONAL_HARDENING.md`) — an SDK is a re-implementation of the same discipline in a product's own stack, never a relaxation of it.

## 4. `src/contracts/` — today's role, and its future

`src/contracts/` (Phase 2D.10) is NOT a package — it is type aliases and re-exports over this platform's own existing, tested interfaces (`AuthenticatedExternalPrincipal`, `ResourceAuthorizationContext`, `ResourceAuthorizationPolicy`, `AuthorizationDecision`, `ProductAccessDecision`, the two error-code unions), used today only by this repository's own contract test (`tests/phase2d10-product-integration-contract.e2e-spec.ts`) to prove those stable names are sufficient to author a working policy without reaching into internal module paths.

If/when a real Node-based product needs a genuine, separately-installable package, `src/contracts/` is the design source that package's initial version would be extracted from — at that point it would move to its own repository (never a path/package dependency FROM `identity-platform` TO a product, or vice versa — the absolute isolation rule applies to any future SDK exactly as it applies to everything else in this project) and be versioned independently per `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1's compatibility rules.

## 5. Explicitly deferred (brief §23)

No SDK implementation, no generated client, no per-language package, in this phase or any prior one.
