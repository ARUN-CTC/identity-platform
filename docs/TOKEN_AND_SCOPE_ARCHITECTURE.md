# Token and Scope Architecture (OAuth/OIDC Extension)

Detail document for ADR-016. Extends `docs/TOKEN_ARCHITECTURE.md` (the existing, Phase 1–2C design) rather than replacing it — the existing proprietary token's claim shape (`AccessTokenClaims`: `sub`, `tenantId`, `sessionId`, `email`, `organizationId`) is unchanged and continues to work exactly as it does today.

## 1. Claim-by-claim rationale (every claim justified individually, per the brief's own requirement)

| Claim | Why needed | Who consumes it | Authoritative? | Valid how long? | Can it go stale? |
|---|---|---|---|---|---|
| `iss` | Proves which Authorization Server minted this token — required the moment more than one issuer could plausibly exist in a relying party's trust list | Every resource server, locally | Yes — a mismatch is an immediate reject | Life of the token | No — issuer identity doesn't change |
| `sub` | The principal's stable identity — human `security_user.id` or, on a service token, `ServiceAccount.id` | Every resource server; the Identity Platform's own repositories | Yes, as an identifier — never as a proof of current standing (Membership/entitlement are re-checked independently) | Life of the token | The *identifier* never goes stale; what it's *entitled to* can |
| `aud` | Prevents a token issued for one product being replayed against another — the single most important claim a resource server validates (ADR-003, ADR-020) | Every resource server, locally, mandatory | Yes | Life of the token | No |
| `client_id` | Which registered Application requested this token — needed to enforce the application's own scope/grant-type allow-list and for audit correlation | Resource server (optional depth), Identity Platform (issuance-time enforcement) | Yes | Life of the token | No — but the Application itself could be disabled after issuance; already-issued tokens remain valid until natural expiry (bounded, short TTL) |
| `scope` | What the *client* was granted permission to request — bounds a compromised/misbehaving client independent of the user's own standing (`docs/APPLICATION_AUTHORIZATION.md` §1) | Resource server, locally | Yes, for the "may this client call this" question only — never conflated with IAM permission | Life of the token | Rarely — scope grants change less often than user permissions; acceptable staleness window, same as roles today (ADR-003) |
| `iat`/`exp` | Standard freshness/expiry bounds | Every resource server, locally | Yes | N/A (defines validity itself) | N/A |
| `jti` | Unique token identifier for introspection-by-id and audit correlation without logging the whole token | Introspection endpoint (if/when built), audit tooling | Yes, as an identifier | Life of the token | No |
| `tenant_id` | Human tokens only — lets a resource server route to its own tenant-partitioned storage without a round-trip (ADR-016) | Resource server (human tokens only) | **No** — a routing/convenience fact only; Membership is re-derived, never assumed, by anything making an access decision | Life of the token, but re-validated live on every refresh (unchanged Phase 2C behavior) | Yes — mitigated by refresh-time re-validation, `docs/ORGANIZATION_CONTEXT_SECURITY.md` §2 |
| `organization_id` | Human tokens only — the session's currently-selected organization context (Phase 2C, unchanged) | Resource server + Identity Platform's own guards | **No** — same caveat as `tenant_id` | Same as `tenant_id` | Same as `tenant_id` |
| `session_id` | Ties the access token to a specific, independently-revocable session row | Identity Platform's own guards (existing mechanism, unchanged) | Yes, as a revocation handle | Life of the token | No — but the session itself can be revoked, which is exactly the point |
| `nonce` (ID Token only) | Binds the ID Token to one specific `/authorize` request, preventing replay across sessions | The requesting client itself | Yes | Single use, by the client | N/A |
| `auth_time` (ID Token only) | When authentication actually occurred (may predate token issuance via SSO reuse) | The requesting client itself | Yes | N/A | N/A |

**Never included**, per explicit instruction and existing ADR-003 precedent: full membership lists, full role lists, full permission lists, full product-entitlement lists. Each is cheaply re-derivable server-side on demand and changes on a timescale that would make embedding it a staleness liability disproportionate to the convenience gained.

## 2. Human access token (full shape)

```json
{
  "iss": "https://identity.example.com",
  "sub": "<security_user.id>",
  "aud": "<application.client_id or resource-API identifier>",
  "client_id": "<application.client_id>",
  "tenant_id": "<tenant.id>",
  "organization_id": "<organization.id> | null",
  "session_id": "<security_session.id>",
  "scope": "openid profile travelos.read",
  "iat": 1234567890,
  "exp": 1234568790,
  "jti": "<uuid>"
}
```
The existing proprietary token keeps its current, narrower shape (`sub`, `tenantId`, `sessionId`, `email`, `organizationId`, camelCase) unchanged — the shape above applies only to a future OAuth-issued token.

## 3. Service access token (full shape)

```json
{
  "iss": "https://identity.example.com",
  "sub": "<service_account.id>",
  "aud": "<resource-API identifier>",
  "client_id": "<application.client_id>",
  "scope": "documentintel.process",
  "iat": 1234567890,
  "exp": 1234568190,
  "jti": "<uuid>"
}
```
No `tenant_id`, `organization_id`, or `session_id` — a service token is tenant-neutral by design (ADR-015); tenant authorization is a per-request assertion validated against `ServiceAccountTenantGrant`, never a token claim.

## 4. ID Token

See `docs/OIDC_ARCHITECTURE.md` §2 for the full shape and its strict separation from the access token.

## 5. Scope catalog design

Scopes are namespaced identically to IAM permissions (ADR-004's own precedent, reused rather than reinvented): `<product-slug>.<verb>` for product-specific scopes (`travelos.read`, `travelos.write`, `documentintel.process`), plus the three OIDC standard scopes (`openid`, `profile`, `email`). A Product's own `ServiceAccount`/Platform-Operator registration flow owns its own scope namespace, exactly as it already owns its own permission-code namespace (ADR-004) — the Identity Platform enforces namespace ownership (a product cannot register a scope outside its own prefix) without interpreting scope meaning, identical to how it already treats permission codes.

**Implemented (Phase 2D.2)**: `ApplicationScopePolicy.validateScopesForRegistration()` (`src/modules/applications/policies/scope.policy.ts`) enforces exactly this namespace-ownership rule when an Application's `allowedScopes` are registered/updated — verified directly (`tests/phase2d2-application-oauth-client.e2e-spec.ts`: a `healthcare.*`-namespaced scope is rejected when registered under the `travelos` product).

## 6. Audience model

`aud` = a stable per-resource-API identifier, distinct from (but related to) an `Application`'s own `client_id`:
- A **human** token's `aud` = the specific resource API the token is intended for (e.g. `travelos-api`) — not necessarily the same string as the requesting web/mobile Application's own `client_id`, since one product can expose one API consumed by several different client Applications (web, mobile).
- A **service** token's `aud` = the target resource API, explicitly requested at `client_credentials` grant time (a service may be authorized to call more than one API, but each token names exactly one).
- **Audience registration**: each Product registers its own resource-API identifier(s) as part of onboarding (extends `docs/PRODUCT_REGISTRATION.md`, not built in Phase 2D).
- **Multi-audience tokens**: not supported — a single token names exactly one `aud`. A client needing to call two distinct resource APIs requests two tokens (or, for a service, two separate client_credentials grants naming different audiences) — this is the safest model: it makes cross-product replay structurally impossible rather than merely discouraged, and avoids any need for a resource server to reason about "was this token *also* meant for someone else."
- **Token exchange** (RFC 8693 — swapping a token for a differently-audienced one) is explicitly not adopted; not needed while every client can simply request the audience it needs directly, and adopting it would be exactly the kind of unrequested protocol surface this phase's brief instructs against. Formalized as its own decision, alongside impersonation and token forwarding, in ADR-021.

## 7. Implementation status

**The service access token's claim shape (§3) can now be signed and verified** (Phase 2D.1, `ExternalTokenService` — `iss`/`sub`/`aud`/`exp`/`iat`/`nbf`/`jti`, plus `scope`/`tenant_id`/`organization_id`/`client_id` as optional payload fields) — but no endpoint issues it yet; `sign()`/`verify()` exist only as a directly-callable service today, exercised by `tests/phase2d1-external-token-trust-boundary.e2e-spec.ts` and the service's own unit tests, not by any HTTP flow. The human access token (§2) and ID Token (§4) shapes remain entirely unbuilt — no `/authorize`/`/token`/OIDC endpoint exists (`docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap, 2D.3+).

**The service token's future `sub` value now has a real, durable identity behind it** (Phase 2D.3, `docs/PHASE_2D3.md`): `ServiceAccount.id` is exactly the value this document's own claim shape (§3) names as `sub`, and `ServiceAccountTenantGrant` is the durable record a future issuance flow would consult to decide whether a requested `tenant_id` claim may legitimately be included at all. Neither is wired into `ExternalTokenService.sign()` yet — no code path today populates a service token's `tenant_id`/`organization_id`/`client_id` claims from a real `ServiceAccountTenantGrant` lookup; that wiring belongs to whichever future phase actually builds the Client Credentials issuance flow.

**Now wired end to end (Phase 2D.4, `docs/PHASE_2D4.md`)**: `POST /oauth/token` populates every service-token claim from a real, validated lookup — `sub = ServiceAccount.id` (verified against its own credential), `client_id = Application.clientId` (verified via `client_secret_basic`), `tenant_id` = the server-validated, `ServiceAccountTenantGrant`-authorized Tenant (never a client-supplied value taken on faith), `scope` = exactly the requested, allow-listed subset (never expanded or silently reduced). `organization_id` is never populated — no organization context ever applies to a ServiceAccount. §6's "each Product registers its own resource-API identifier(s)... not built in Phase 2D" gap is resolved without a new column: the requested `aud` is validated against `Application.audiences` (Phase 2D.2, unchanged), and the Product for entitlement purposes is simply the audience-validated Application's own `productId` (Phase 2B, unchanged) — see `docs/PHASE_2D4.md`'s "Architecture decisions resolved this phase" §2 for the full reasoning.
