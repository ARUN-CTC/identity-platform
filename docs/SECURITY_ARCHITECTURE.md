# Security Architecture

## 1. Authentication security

- **Password hashing**: Argon2id (unchanged from Phase 1) — memory/time cost parameters reviewed and bumped as hardware improves; parameter changes are transparent to users (rehash-on-login pattern) and don't require a data migration.
- **Credential policies**: minimum length (not composition rules — NIST 800-63B guidance: length over complexity), breach-list check (e.g. HaveIBeenPwned k-anonymity API) on set/change, no forced periodic rotation (also 800-63B guidance) except after a confirmed compromise.
- **Brute-force protection**: `SecurityLoginAttempt` (unchanged) backs both per-identifier lockout (progressive delay, then temporary lock) and per-IP rate limiting; the two are tracked independently so one attacker spraying many accounts from one IP and a credential-stuffing attempt against one account from many IPs are both caught.
- **Rate limiting**: token-bucket per-identifier and per-IP on every pre-auth endpoint (`API_BOUNDARY.md` §9); a distributed limiter (not per-process memory) once the platform runs more than one instance.
- **Session protection**: session fixation is structurally impossible (a new Session is always created at login, never reused); refresh-token rotation with reuse detection (`AUTHENTICATION_ARCHITECTURE.md`) is the primary session-hijack defense.

## 2. Token security

- **Token signing**: asymmetric (RS256 or EdDSA), never a shared symmetric secret once more than one relying party exists (`TOKEN_ARCHITECTURE.md` §7) — this is a hard requirement, not a nice-to-have, the moment a second product is onboarded.
- **Key management**: private signing key held only by the Identity Platform, never leaves its process boundary; public keys published via a JWKS endpoint (`/.well-known/jwks.json`), cached by products with a sane TTL and background refresh.
- **Key rotation**: scheduled rotation (e.g. quarterly) plus an emergency-rotation runbook (compromise response); overlapping validity window (old key stays in the published JWKS, marked non-current, until every token it signed has naturally expired — bounded by the access-token TTL, which is exactly why that TTL is kept short).
- **Refresh token rotation**: every use issues a new refresh token and invalidates the old one; a reused (already-rotated) token is treated as theft evidence and revokes the entire session chain (`AUTHENTICATION_ARCHITECTURE.md`).
- **Revocation**: refresh-token/session revocation is immediate and authoritative. Access-token revocation before natural expiry is *not* guaranteed by default — this is a deliberate trade-off (stateless validation is the whole point of a JWT) bounded by keeping access-token TTL short (minutes, not hours). Products with a genuine need for instant kill-switch semantics (e.g. a compliance requirement) may opt into a denylist check: the Identity Platform publishes revoked-session-id events (webhook or a pollable "recently revoked" endpoint) and the product checks a local cache of that list on each request — an explicit opt-in cost, not a default tax on every product.
- **Replay protection**: `aud` validation (mandatory, `TOKEN_ARCHITECTURE.md` §3) prevents cross-product replay; short TTL plus `jti` (unique token id) logging lets a product detect and alert on a token being presented from two wildly different network locations in an implausibly short window, if it chooses to.

## 3. Authorization security

- **Tenant isolation**: PostgreSQL RLS (`app.current_tenant_id` GUC), unchanged mechanism from Phase 1 — still the platform's single most valuable isolation primitive (`IDENTITY_SOURCE_INVENTORY.md`).
- **Organization isolation**: enforced at the application layer (`OrganizationAccessService`, unchanged) — a grant scoped to Organization A never satisfies a check against Organization B, verified fresh per request (no caching of the grant resolution itself, only of expanded permission lists where a product opts into that, per `TOKEN_ARCHITECTURE.md` §6).
- **Permission enforcement**: `PermissionsGuard` (core) unchanged; product-side enforcement is the product's own responsibility (`AUTHORIZATION_ARCHITECTURE.md` §3) — the Identity Platform cannot and does not enforce product-domain checks.
- **RLS**: unchanged from Phase 1; extends naturally to every new table introduced in Phase 2 (Application, Product, TenantProductSubscription, ServiceAccount) — `TenantProductSubscription` and `ServiceAccount` are tenant-partitioned where they belong to a tenant; `Product` and `Application` are platform-catalog tables, not tenant-partitioned, and must never gain a `tenant_id` column (that would imply a product belongs to one tenant, which is backwards).
- **Privilege escalation prevention**: the grant-ceiling rule (`AUTHORIZATION_ARCHITECTURE.md` §4) is the primary defense — a caller cannot grant more than they hold, checked as opaque permission-code set comparison so it works identically across core and every product namespace without the Identity Platform needing to understand any of them.

## 4. Application security

- **CORS**: `Application.allowed_origins` (`PRODUCT_REGISTRATION.md`) is the source of truth — no wildcard origins in any environment beyond local dev.
- **CSRF**: moot for the token-bearer pattern (Authorization header, not cookies) used by the primary browser/mobile flow; if any future flow uses cookies (e.g. an SSR product reading a session cookie), standard double-submit/SameSite protections apply to that flow only.
- **Security headers**: standard set (HSTS, X-Content-Type-Options, frame-ancestors/CSP where the Identity Platform serves any HTML — e.g. an invitation-accept or password-reset web page) unchanged in principle from good NestJS defaults, tightened during Phase 2 implementation.
- **Input validation**: `class-validator` DTOs (unchanged mechanism from Phase 1) on every endpoint, including the new Application/Product/Subscription/ServiceAccount ones.
- **API rate limiting**: per §1 and `API_BOUNDARY.md` §9.
- **Secret management**: `client_secret` values are hashed at rest (never stored plaintext, mirroring the refresh-token pattern) and shown to the registering caller exactly once, at creation; JWT signing keys and any third-party integration secrets (mail provider, breach-list API) live in a secrets manager appropriate to the deployment target, never in `.env` files committed to source control (Phase 1's `.env.example` tripwire pattern is retained and extended to new secrets).

## 5. Service-to-service authentication (Step 12)

**Decision: OAuth2 Client Credentials grant, using each Product's registered `Application` as the credential holder, with mTLS reserved as a future upgrade rather than a Phase 2 requirement.**

Options considered:

| Option | Assessment |
|---|---|
| OAuth2 client credentials | Standards-based (RFC 6749 §4.4), works identically regardless of the calling product's language/stack (no shared library required — every mainstream HTTP client can do a client-credentials POST), reuses the same `Application`/token-issuance machinery already built for user auth. **Chosen.** |
| Service accounts (bespoke, non-OAuth) | Reinvents client-credentials without the standards benefit — rejected in favor of expressing the same concept (`ServiceAccount` belongs to an `Application`) *through* the standard grant type rather than a proprietary one. |
| mTLS | Strongest transport-level guarantee (cryptographic proof of the calling service's identity, not just a bearer secret) but requires certificate issuance/rotation infrastructure across every product's deployment environment — real operational cost for three initial products with likely-different deployment platforms. **Deferred**, documented as the natural upgrade path for any product with a genuine zero-trust-network requirement, layered *underneath* OAuth (mTLS for transport identity + client-credentials for the application-level grant), not a replacement for it. |
| Signed service tokens (JWT client assertion, RFC 7523) | A reasonable harder-than-shared-secret alternative to a plain `client_secret` — recommended as the *credential form* products should move to as they mature (the Application authenticates with a self-signed JWT instead of a static secret, removing a long-lived shared secret from the picture entirely), but not required for Phase 2's baseline. |
| API keys | Rejected as the primary mechanism — a static, long-lived key sent on every request is strictly worse than a short-lived token obtained via client-credentials and is exactly the "excessive, long-lived credential" pattern the rest of this architecture avoids for user tokens too. |

Recommendation for an enterprise SaaS platform at this stage: **client credentials now, with client-secret rotation support and audit logging on every token issuance (`SERVICE_TOKEN_ISSUED`), JWT client-assertion as the recommended upgrade for any product handling sensitive data (Healthcare is the obvious first candidate), and mTLS reserved for a genuine zero-trust deployment requirement, not built speculatively.**

## 6. Audit event catalog

`LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `PASSWORD_CHANGED`, `PASSWORD_RESET_REQUESTED`, `SESSION_CREATED`, `SESSION_REFRESHED`, `SESSION_REVOKED`, `REFRESH_TOKEN_REUSE_DETECTED`, `ORGANIZATION_CONTEXT_SWITCHED`, `ROLE_CREATED`, `ROLE_ASSIGNED`, `ROLE_REMOVED`, `PERMISSION_CHANGED`, `PRODUCT_PERMISSION_REGISTERED`, `INVITATION_CREATED`, `INVITATION_ACCEPTED`, `MEMBERSHIP_CREATED`, `MEMBERSHIP_REMOVED`, `ORGANIZATION_CREATED`, `ORGANIZATION_UPDATED`, `TENANT_PRODUCT_SUBSCRIPTION_CHANGED`, `SERVICE_TOKEN_ISSUED`, `USER_PROFILE_UPDATED`. All carry `actor` (Identity or ServiceAccount id, nullable for system-initiated events), `tenant_id`/`organization_id` where applicable, `correlation_id` (`OBSERVABILITY.md`), and never carry a raw credential, token, or password in `metadata` — logging redaction is enforced at the event-writer level, not left to each call site's discipline.
