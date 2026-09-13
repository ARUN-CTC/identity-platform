# Phase 2D — External Application & Service Authentication Architecture

**Status: this document itself remains architecture and ADR only, as originally written and gate-reviewed (§9/§10 below).** Seven implementation sub-phases have since been built: **2D.1 (cryptographic foundation and legacy/external token trust boundary, `docs/PHASE_2D1.md`)**, **2D.2 (Application/OAuth Client foundation — registration, lifecycle, grant/scope/audience/redirect-URI/origin policy enforcement, `docs/PHASE_2D2.md`)**, **2D.3 (ServiceAccount & Tenant Grant foundation — machine identity, per-tenant authorization, `docs/PHASE_2D3.md`)**, **2D.4 (OAuth 2.0 Client Credentials flow — `POST /oauth/token`, the first endpoint that actually issues an external token, `docs/PHASE_2D4.md`)**, **2D.5 (Resource Server JWT Validation & Authorization Context — the reusable consuming-side validator/guard, `docs/PHASE_2D5.md`, `docs/RESOURCE_SERVER_ARCHITECTURE.md`)**, **2D.6 (Product Resource Authorization Contract & Integration Boundary — the reusable, product-neutral policy/scope/entitlement contract layered on 2D.5's principal, `docs/PHASE_2D6.md`, `docs/RESOURCE_AUTHORIZATION_CONTRACT.md`)**, and **2D.7 (OAuth Authorization Code + PKCE — `GET /oauth/authorize` + `POST /oauth/token` with `grant_type=authorization_code`, the human-user counterpart to 2D.4's machine flow, `docs/PHASE_2D7.md`, `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`)** — see the updated Implementation Readiness Matrix rows in §10. OIDC remains entirely unbuilt (deferred to 2D.8) — every other row/sub-phase remains design-only, unimplemented, exactly as this document originally specified.

## 1. Objective

Phase 1 built a single, first-party, proprietary bearer-token authentication API. Phases 2A–2C extended it into a full multi-tenant, multi-organization, context-switching Identity model — but every consumer of that model has, so far, been the Identity Platform's own first-party surface. Phase 2D answers: **how do external consumers — other products' web/mobile applications, other products' own backend APIs, background services, and eventually genuine third parties — securely trust and consume this platform**, without weakening anything Phase 1–2C already built, and without building anything not yet actually needed (per ADR-007's own phased, trigger-gated adoption path).

## 2. Current Architecture Understanding (as inspected, not assumed)

Re-inspected fresh for this phase, not recalled from memory:

- **Token today**: HS256-signed JWT (`src/modules/jwt/jwt.module.ts` — a single symmetric `JWT_ACCESS_SECRET`), claims `{ sub, tenantId, sessionId, email, organizationId? }` (`AccessTokenClaims`, `src/modules/jwt/services/token.service.ts`). **No `aud`, no `iss`, no `jti`, no `scope`** — despite ADR-003/`docs/TOKEN_ARCHITECTURE.md` already having designed for `aud` and asymmetric signing. This is a real, self-acknowledged gap (the code comments say so directly) that this phase's design must close.
- **Refresh**: opaque, tenant-prefixed, rotation-with-reuse-detection (`RefreshTokensRepository`) — genuinely solid, reused as-is (§21).
- **Application == Client** (ADR-009): `application` table already has `clientId`, `clientSecretHash`, `clientType` (`CONFIDENTIAL`|`PUBLIC`), `redirectUris`, `allowedOrigins`, `secretCreatedAt`/`secretRevokedAt` — explicitly pre-provisioned by Phase 2B "for future OAuth2/OIDC use," unread/unenforced today.
- **Product/Application/Entitlement** (Phase 2B/2B.1/2B.2): `Product` and `Application` are platform-level, no RLS; `TenantProductEntitlement` is the durable, tenant-level "may this tenant use this product at all" gate, evaluated by `ProductAccessService`, entirely independent of authentication mechanism.
- **Platform Operator** (Phase 2B.1, ADR-010): a structurally separate principal from any tenant-scoped Identity — its own tables, sessions, guards. Administers Product/Application/Entitlement today; will administer OAuth client configuration and future `ServiceAccount`/tenant-grant rows the same way.
- **Organization Context** (Phase 2C, ADR-012): session-level `organizationId`, never trusted from a client claim alone, always re-derived server-side (Membership → Organization → Tenant), re-validated live on every refresh. This is the model Phase 2D's OAuth integration (ADR-019) extends, not replaces.
- **IAM permission enforcement**: already decided (ADR-004) to be **product-local**, never centrally enforced by the Identity Platform for product-namespaced (`<product>.*`) permission codes — this fact alone answers several of this phase's "who enforces what" questions before any new design is needed.

## 3. Recommended Architecture

The Identity Platform becomes, additively, an **OAuth 2.1 Authorization Server** (ADR-013) and **OpenID Connect Provider** (ADR-014), on top of — never in place of — its existing proprietary bearer-token API. Products become OAuth clients (their web/mobile applications) and resource servers (their APIs). This is not a rewrite: every entity (`security_user`, `Membership`, `Organization`, `Tenant`, `Product`, `Application`, `TenantProductEntitlement`) is reused unchanged; OAuth/OIDC is a new *protocol surface* wrapping the same domain model, exactly as ADR-007 anticipated.

```text
                         IDENTITY PLATFORM
                    (Authorization Server + OIDC Provider)
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                              │
   HUMAN PRINCIPAL                            SERVICE PRINCIPAL
   (security_user, existing)                  (ServiceAccount, NEW — future)
        │                                              │
   authorization_code + PKCE                    client_credentials
   (ADR-013, ADR-019)                           (ADR-006, ADR-015)
        │                                              │
        ▼                                              ▼
  Human Access Token                          Service Access Token
  (+ optional ID Token, ADR-014)               (tenant-neutral, ADR-015)
        │                                              │
        └──────────────────────┬──────────────────────┘
                               ▼
                         PRODUCT API
                      (resource server, ADR-020)
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       Application Scope   User/Service     Product Entitlement
        (OAuth, ADR-016)   IAM Permission    (unchanged, ADR-011)
                          (product-local,
                            ADR-004)
              └────────────────┼────────────────┘
                               ▼
                    Organization Context (human only)
                       → Tenant → RLS (product's own)
```

**What fits as-is**: the entire domain model, RLS pattern, refresh-token rotation, Platform Operator boundary, product entitlement model, and the "client selects, server validates" principle from Phase 2C — plus, per the Architecture Gate review (§9), the existing HS256-signed proprietary token itself, which is **not migrated at all** (see Gate 1).
**What must be added** (future implementation, not this phase; additive, not a replacement of anything existing): a new RS256 signing key + JWKS endpoint, used exclusively for new OAuth/OIDC-issued tokens (ADR-017, as amended by the Gate review); `aud`/`iss`/`jti`/`scope` claims on that new token type (ADR-016); `Application` gains conceptual grant-type/scope/audience attributes (ADR-018); a new `ServiceAccount` entity and `ServiceAccountTenantGrant` (ADR-015, ADR-006, ADR-005, `docs/PRODUCT_REGISTRATION.md` §2.4 — pre-existing, reaffirmed by the Gate review, not newly invented by Phase 2D).
**What is deferred**: authorization_code/PKCE implementation itself, OIDC ID tokens, and any third-party developer-facing surface remain gated behind ADR-007's own named-requirement trigger — this document designs them so the design is ready, not to build them now.

## 4. Key Architectural Questions — Explicit Answers

1. **Who is the Authorization Server?** The Identity Platform (ADR-013). No external IdP (ADR-008, reaffirmed).
2. **Who is the OpenID Provider?** The Identity Platform, additively (ADR-014).
3. **What is an Application?** The registered, credentialed consumer of this platform's API for one Product (unchanged, ADR-005/ADR-009).
4. **What is a Client?** The same row as Application (ADR-009).
5. **Are Application and Client still the same entity?** Yes — reaffirmed (ADR-018).
6. **What is a Resource Server?** A Product's own API, validating tokens this platform issued (ADR-020).
7. **What identifies a human principal?** `security_user.id`, via `sub` (unchanged since Phase 1).
8. **What identifies a service principal?** A future `ServiceAccount.id`, via `sub` — never a human `security_user` row (ADR-015, ADR-018).
9. **How are public clients authenticated?** They aren't (no secret) — PKCE is their only proof of possession (§Human Authentication, ADR-013).
10. **How are confidential clients authenticated?** `client_id` + `client_secret` (existing mechanism, `clientSecretHash`), unchanged (ADR-006).
11. **Is PKCE mandatory?** Yes, for every client type, always (OAuth 2.1 — ADR-013).
12. **How is organization context selected?** Client supplies only a hint; server derives/validates via the existing Phase 2C chain (ADR-019).
13. **Can organization context appear in tokens?** Yes, `organization_id`, nullable, human tokens only (ADR-016).
14. **Can tenant context appear in tokens?** Yes, `tenant_id`, human tokens only, never on service tokens (ADR-016, ADR-015).
15. **What is authoritative when JWT and server state disagree?** Server state, always (`docs/ORGANIZATION_CONTEXT_SECURITY.md` §2, unchanged, reaffirmed for OAuth in ADR-019).
16. **How are product entitlements evaluated?** Unchanged — `ProductAccessService`, live or short-TTL-cached by the resource server, never embedded in a token (ADR-020 step 9, ADR-011 reaffirmed).
17. **How are IAM permissions evaluated?** Product-local, using namespaced permission codes (ADR-004, reaffirmed, unchanged).
18. **How are OAuth scopes evaluated?** Locally, by signature-verified `scope` claim, string-set membership check (ADR-020 step 5, ADR-016).
19. **How is audience enforced?** Mandatory local `aud` check by every resource server against its own registered identifier (ADR-003 reaffirmed, ADR-016, ADR-020).
20. **How are signing keys rotated?** Scheduled + emergency rotation, overlapping-validity window, `kid`-driven JWKS lookup (ADR-017, `docs/KEY_MANAGEMENT_ARCHITECTURE.md`).
21. **How are refresh tokens rotated?** Unchanged — opaque, rotate-on-use, reuse-detection revokes the session chain (§21, `docs/PHASE_1.md`/Phase 2A-2C behavior, reaffirmed).
22. **How are tokens revoked?** Session/refresh-token revocation (existing, immediate) for anything session-bound; access-token revocation is bounded by short TTL, with `jti`-based introspection available for high-security cases (`docs/EXTERNAL_API_TRUST_BOUNDARY.md`).
23. **How are compromised clients disabled?** `Application.status` set to a disabled state (existing mechanism) — every future token request for that client is rejected at issuance; already-issued tokens expire naturally within their short TTL, or are force-revoked via session/refresh revocation for anything session-bound.
24. **How are services authorized for tenants?** `ServiceAccountTenantGrant`, request-time assertion validated against it — never embedded in the token (ADR-015).
25. **How are Platform Operators separated?** Unchanged (ADR-010) — they administer OAuth client/service-grant configuration; they never become organization members or gain human tenant access by virtue of that role (`docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md` §Platform Operator interaction).
26. **How are product APIs protected?** The resource-server pipeline (ADR-020).
27. **How does Identity Platform failure affect product availability?** Previously-issued, unexpired, correctly-audienced access tokens remain locally verifiable with zero live dependency (`docs/AVAILABILITY_MODEL.md`, reaffirmed) — only entitlement checks a product chooses to make live, and any *new* token issuance/refresh, are affected.
28. **How does this work across TravelOS, Healthcare, and Gym?** Each is one `Product`, each with one or more `Application`s (web, mobile, backend) and its own `aud` — a token for one is never valid for another (§Multi-Product Architecture, `docs/EXTERNAL_API_TRUST_BOUNDARY.md`).
29. **What is implemented in Phase 2D?** Nothing — architecture, ADRs, documentation only.
30. **What remains explicitly deferred?** Everything listed in §Deferred Scope below.

## 5. Backward Compatibility

- **Unchanged**: every existing endpoint (`/auth/login`, `/auth/refresh`, `/auth/context/*`, `/me/*`), every existing token's claim shape, every existing session/refresh-token row, every RLS policy, every guard.
- **Becomes "legacy" only in the sense of "not OAuth-issued"**: the proprietary bearer token is not deprecated — it remains the primary mechanism for the Identity Platform's own first-party surfaces indefinitely (ADR-013).
- **Existing tokens/sessions**: continue working unmodified through and after any future OAuth implementation — nothing about issuing a *new* token type changes how *existing* tokens are validated.
- **Future migration strategy** (revised by the Architecture Gate review, §9 Gate 1/10): there is no HS256 → RS256 *migration* of the existing token at all — the legacy HS256 path is **permanent**, since it is verified exclusively inside the Identity Platform's own trust boundary and was never exposed to the risk asymmetric signing exists to close. RS256/JWKS is purely **additive** infrastructure for the new OAuth/OIDC token type. No overlap period is needed because nothing is being cut over; no forced re-login, no session invalidation, no eventual retirement date for `JWT_ACCESS_SECRET`.

## 6. Implementation Roadmap (future — none of this is built in Phase 2D)

```text
2D.1  Cryptographic foundation & legacy/external token trust boundary — ✅ COMPLETE
      (RS256 keypair, kid-based lookup, JWKS endpoint, legacy-verifier
      algorithm pinning) — ADR-017, docs/PHASE_2D1.md. Deliberately built
      with ZERO persistent schema (config/in-memory key material only) —
      renumbered ahead of the data-model step below on implementation,
      since it needed no table and unblocks every later sub-phase.
2D.2  Application/OAuth Client foundation — ✅ COMPLETE (docs/PHASE_2D2.md):
      Application extended with grantTypes/allowedScopes/audiences/
      tokenEndpointAuthMethod (additive migration); registration/update-time
      policy enforcement (grant-type, scope-namespace, audience, redirect-URI,
      origin); composed OAuthApplicationPolicyService eligibility check.
      ServiceAccount, ServiceAccountTenantGrant, and AuthorizationCode remain
      NOT built — sequenced once a concrete endpoint (2D.3+/2D.9) actually
      needs that storage, not before.
2D.3  Authorization endpoint (/authorize) — human-facing, organization-hint integration (ADR-019) — ✅ COMPLETE
      (built as part of Phase 2D.7, below, rather than as its own slot —
      `/authorize` and its `/token` exchange were implemented together
      since neither is independently useful without the other)
2D.4  Authorization Code + PKCE exchange (/token, authorization_code grant) — ✅ COMPLETE
      (docs/PHASE_2D7.md, docs/OAUTH_AUTHORIZATION_CODE_PKCE.md — built as
      Phase 2D.7, after 2D.1-2D.6 rather than immediately after 2D.1-2D.2,
      once the ServiceAccount/entitlement/resource-server/authorization-
      contract foundation those phases built was already available for the
      human token to reuse identically — see "Note on implementation
      order" below)
2D.5  Token endpoint refresh_token grant integration (reuse existing rotation/reuse-detection machinery) — NOT built
      (Phase 2D.7 deliberately issues no refresh_token for the
      authorization_code grant — the existing SecurityRefreshToken system
      is bound to the legacy HS256 SecuritySession model and is not safely
      reusable for an RS256 external token with no SecuritySession of its
      own; building a second, parallel refresh-token implementation was
      explicitly out of scope for that phase — docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §16)
2D.6  OIDC ID Token issuance (openid scope, nonce, auth_time) — ADR-014
2D.7  OIDC discovery document (/.well-known/openid-configuration) — JWKS itself already shipped in 2D.1
2D.8  Resource-server validation reference implementation/SDK guidance (ADR-020 pipeline) — ✅ COMPLETE
      (docs/PHASE_2D5.md, docs/RESOURCE_SERVER_ARCHITECTURE.md, ahead of this
      slot): ExternalAccessTokenValidator/JwksClientService/ExternalBearerAuthGuard
      implement pipeline steps 1-7 (signature/issuer/audience/kid/expiry/
      principal/scope-exposure). The steps 8-9 CONTRACT (ResourceAuthorizationPolicy/
      ResourceAuthorizationGuard, docs/PHASE_2D6.md, docs/RESOURCE_AUTHORIZATION_CONTRACT.md)
      is now also built, ahead of this slot — Identity Platform ships the
      seam, never a product's own implementation of it. Step 11
      (tenant-scoped data access) remains, correctly, each product's own
      responsibility — never centralized here.
2D.9  Client Credentials grant + ServiceAccount (ADR-006, ADR-015) — ✅ COMPLETE
      (docs/PHASE_2D4.md, ahead of this slot): the ServiceAccount identity
      model (2D.3) and the actual token-issuance flow (POST /oauth/token,
      client_credentials grant, 2D.4) are both now built.
2D.10 ServiceAccountTenantGrant admin surface (Platform Operator) — ✅ COMPLETE, ahead of this slot (see note below)
2D.11 Revocation/introspection endpoints (as needed — ADR-020's local-first default may make this low-priority)
2D.12 Product integration (first real resource-server adoption — TravelOS, by existing precedent)
2D.13 Security hardening pass (equivalent to the Phase 2C stabilization review, applied to the new surface)
```

**Note on implementation order vs. this list's numbering**: the actual build sequence named its third through seventh implementation sub-phases **"2D.3"** (`docs/PHASE_2D3.md`), **"2D.4"** (`docs/PHASE_2D4.md`), **"2D.5"** (`docs/PHASE_2D5.md`), **"2D.6"** (`docs/PHASE_2D6.md`), and **"2D.7"** (`docs/PHASE_2D7.md`) rather than waiting for the slots numbered 2D.3-2D.5/2D.8/2D.9/2D.10 above (and rather than this list's own "2D.6," originally "OIDC ID Token issuance," which remains entirely unbuilt) — together the five actually-built sub-phases cover the full `ServiceAccount` identity model + token-issuance flow (2D.9, in full), the full `ServiceAccountTenantGrant` admin surface (2D.10, in full: create/list/get/patch/reactivate, tenant-first nested under `/platform/tenants/:tenantId/service-account-grants`), the resource-server validation pipeline's steps 1-9 (2D.8, in full — steps 1-7 the validator itself, steps 8-9 the authorization contract), and this list's own "2D.3" (`/authorize`) + "2D.4" (Authorization Code + PKCE exchange), built together as Phase 2D.7 rather than as two separate slots. This list's own numbering is left as originally written (the *order*, not a committed calendar, per the line below) rather than renumbered after the fact; `docs/PHASE_2D3.md`/`docs/PHASE_2D4.md`/`docs/PHASE_2D5.md`/`docs/PHASE_2D6.md`/`docs/PHASE_2D7.md` are the authoritative record of what was actually built and when.

Every sub-phase above remains gated on ADR-007's own trigger (a named third-party/delegated-access or enterprise-SSO requirement) before implementation begins — this roadmap is the *order*, not a committed calendar.

## 7. Deferred Scope (explicitly confirmed NOT part of Phase 2D)

OAuth/OIDC/introspection/revocation endpoints, database migrations, new tables, MFA, Passkeys, SAML, SCIM, social login, billing, subscriptions, usage metering, SDKs, a developer portal, an API marketplace, TravelOS/Healthcare/Gym integration work, third-party onboarding UI, impersonation, any runtime/dependency/environment change. See `docs/PHASE_2D_ARCHITECTURE.md` §6 for what triggers each future piece.

## 8. Non-Negotiable Principles Preserved

Every principle listed in this phase's own brief (§40) is preserved by construction across every ADR/document in this phase — see `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §Trust Boundaries and `docs/PHASE_2D_THREAT_MODEL.md` for the explicit, per-threat verification of each.

## 9. Architecture Gate Review — 10 Gates, Resolved

A dedicated post-design gate review (independent of the design pass itself — re-inspecting the actual repository and every ADR fresh, not trusting the design report alone) resolved the following before implementation may begin. Two corrections came out of this review, both documented transparently in the affected ADRs rather than silently applied: **ADR-017** was refined (Gate 1, below) and **ADR-018/ADR-015** were amended and then the amendment itself was retracted on further inspection (Gate 3, below) — the retraction is left visible in both ADRs as the record of how the correct answer was actually reached.

**Gate 1 — HS256 → asymmetric signing.** **Decision: Option A** (keep HS256 for the legacy proprietary token; asymmetric signing for OAuth/OIDC tokens only) — **not** Option B (migrate everything) or C (versioned dual-signing as a *transitional* state). This is a permanent architectural split, not a migration: the legacy token is verified exclusively by this platform's own `JwtAuthGuard`, inside one trust boundary, and was never exposed to the multi-verifier risk asymmetric signing exists to close (ADR-017, amended). Zero impact on existing sessions/tokens/APIs — see Gate 10.

**Gate 2 — Legacy vs. OAuth trust boundary.** Structural, not just conventional: the two token types use cryptographically incompatible verification paths (`JwtAuthGuard` holds only the HS256 secret and never receives RS256 key material; external resource servers receive only the RS256 public key via JWKS and never receive `JWT_ACCESS_SECRET`) — a resource server cannot verify a legacy token even by mistake, and `JwtAuthGuard` cannot verify an OAuth token even by mistake, provided each pins its expected algorithm rather than trusting the token header's own `alg` (ADR-017 amendment; `docs/PHASE_2D_THREAT_MODEL.md` #7). Defense in depth: `alg` (HS256 vs RS256), `aud` (legacy token: none/self-referential; OAuth token: always a real resource-API identifier), `kid` (RS256 tokens only). No deprecation strategy is needed for the legacy path — it is not being deprecated.

**Gate 3 — Application vs. ServiceAccount.** **Decision: `ServiceAccount` remains a genuinely separate entity** (reaffirming ADR-005/ADR-006/`docs/PRODUCT_REGISTRATION.md` §2.4's pre-existing, already-approved design) — belonging to exactly one `Application`, authenticating via that Application's own `client_id`/`client_secret` (no separate credential), one Application supporting many `ServiceAccount`s (`Application 1───N ServiceAccount`, `docs/PRODUCT_REGISTRATION.md` §3). This gate review first (incorrectly) proposed eliminating `ServiceAccount` as an unnecessary abstraction; that proposal is retracted in ADR-018 with the specific case it missed (one product surface running many independent automated processes, each needing its own audit/scope/tenant-grant identity without its own full client registration) — see ADR-018's "Gate Review Correction" for the complete reasoning.

**Gate 4 — Service tenant/product authorization.** **Decision: Option D (hybrid), reaffirmed** — a tenant-neutral service token, a per-request tenant assertion, validated against a durable `ServiceAccountTenantGrant` (keyed by `ServiceAccount.id`), itself layered underneath the unchanged `TenantProductEntitlement` check. Neither entitlement concept is duplicated: `TenantProductEntitlement` answers "is this tenant using this product at all"; `ServiceAccountTenantGrant` answers "is this specific service identity allowed to act on this specific tenant" — demonstrated as genuinely necessary (not merely convenient) by the two-ServiceAccounts-under-one-Application worked example in ADR-015's own Gate Review Amendment.

**Gate 5 — Organization context in external tokens.** **Decision: Option B** (`organization_id` + `tenant_id`, both present, `organization_id` nullable), reaffirming ADR-016/`docs/TOKEN_ARCHITECTURE.md` §5's pre-existing design, now formalized for the OAuth-issued token too. **Explicit disagreement rule**: server-side state is always authoritative; a JWT claim is a routing/convenience fact only, re-derived and re-validated live by `resolveGrants()`-equivalent logic on every authorization-relevant request, and by the refresh-time re-validation Phase 2C already built and its own stabilization review already verified (`docs/ORGANIZATION_CONTEXT_SECURITY.md` §2, ADR-019).

**Gate 6 — OAuth scope vs. IAM permission.** **Decision, reaffirmed**: never collapsed. Full pipeline: `Issuer → Audience → Application → Scope → Principal → Organization Context → Membership → Product Entitlement → IAM Permission → RLS` (ADR-020, `docs/APPLICATION_AUTHORIZATION.md` §1). **Conditional layering, made explicit by this gate**: the full 10-step pipeline applies to human tokens; a **service** token has no Organization Context/Membership steps at all (tenant-neutral by design, Gate 4) — those two steps are replaced, not skipped, by the `ServiceAccountTenantGrant` check, which plays the analogous "is this principal actually authorized for this tenant" role for a service that Membership plays for a human. IAM permission enforcement is never conditional — always product-local, always required (ADR-004, unchanged).

**Gate 7 — Audience & resource-server trust.** **Decision, reaffirmed**: `aud` = a stable per-resource-API identifier, mandatory, locally validated by every resource server; no multi-audience tokens, no token exchange as a substitute (ADR-016 §6, ADR-020 step 3). Each product registers its own resource-API identifier(s); each resource server obtains Identity Platform public keys via JWKS, cached with a sane TTL, selected by `kid` (`docs/KEY_MANAGEMENT_ARCHITECTURE.md`).

**Gate 8 — Refresh, revocation, availability.** **Decision, reaffirmed**: opaque refresh tokens, rotation-on-use, reuse-detection revoking the full session chain — unchanged from Phase 1–2C, reused as-is for OAuth-issued refresh tokens too. **Local JWT validation is the default; introspection is the explicit exception**, reserved for callers with a named, unusually tight revocation-latency requirement (ADR-020, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §3). Outage behavior: every previously-issued, unexpired, correctly-audienced access token remains fully, locally verifiable with zero live Identity Platform dependency; only new issuance/refresh, `/userinfo`, and any product's own choice to live-check entitlement are affected (§4 above, unchanged by this gate).

**Gate 9 — Token Exchange & impersonation.** **Decision, newly formalized (ADR-021, added by this gate)**: Token Exchange (RFC 8693) **deferred**, no named requirement yet; impersonation **prohibited unconditionally** — no mechanism, anywhere, lets one principal assume another's identity, including Platform Operators (extending, not just repeating, the existing ADR-010 boundary); token forwarding **prohibited as a supported pattern** — every service-to-service hop authenticates with its own credential, a human's identity (if needed downstream) travels only as inert request data, never as a substituted bearer credential. This closes the "confused deputy" and "token forwarding" gaps this gate discovered were not previously named as their own threats (`docs/PHASE_2D_THREAT_MODEL.md` #28–29, added).

**Gate 10 — Migration and backward compatibility.** **Decision, simplified by Gate 1's refinement**: there is no migration of the existing token, session, or API surface at all — Gate 1's permanent HS256/RS256 split means the "migration" is purely additive infrastructure standup (a new keypair, a new JWKS endpoint, new endpoints for a new token type), not a cutover. Existing sessions, existing refresh tokens, and every existing API contract are entirely unaffected, indefinitely — no rollback plan is needed for something that never cuts over, and no deprecation date exists for `JWT_ACCESS_SECRET` (`docs/PHASE_2D_ARCHITECTURE.md` §5, ADR-017 amendment).

## 10. Implementation Readiness Matrix

| Area | Architecture Decision | Implementation Dependency | Ready? |
|---|---|---|---|
| OAuth AS | ADR-013 — additive Authorization Server role | None — additive to existing app | ✅ |
| OIDC | ADR-014 — additive ID Token, distinct from access token | Depends on OAuth AS (above) | ✅ |
| Authorization Code | `docs/OAUTH_ARCHITECTURE.md` §2/§5 — single-use, short-lived, bound to client/redirect/PKCE | New `AuthorizationCode` storage | ✅ **IMPLEMENTED** (Phase 2D.7 — `oauth_authorization_code`, `AuthorizationCodesRepository`, `docs/PHASE_2D7.md`) |
| PKCE | `docs/OAUTH_ARCHITECTURE.md` §3 — mandatory, `S256` only, every client | None | ✅ **IMPLEMENTED** (Phase 2D.7 — `S256` only, `plain` rejected, constant-time verification, `src/modules/oauth/utils/pkce.util.ts`) |
| Token endpoint | `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §2 — full request/response/security contract per grant type | Depends on signing keys, Authorization Code, refresh-token reuse (all ready) | ✅ **IMPLEMENTED for `client_credentials`** (Phase 2D.4 — `POST /oauth/token`, `docs/PHASE_2D4.md`) **and `authorization_code`** (Phase 2D.7 — same endpoint, `AuthorizationCodeGrantService`, `docs/PHASE_2D7.md`); `refresh_token` grant at this endpoint is not built (Phase 2D.7 deliberately issues no refresh token for `authorization_code` — see that phase's own §16) |
| JWT signing | ADR-017 (as amended) — RS256, additive, permanent HS256/RS256 split | None — resolved this gate | ✅ **IMPLEMENTED** (Phase 2D.1 — `ExternalTokenService`, `docs/PHASE_2D1.md`; actually issuing a real token via `POST /oauth/token` **IMPLEMENTED** Phase 2D.4) |
| JWKS | `docs/KEY_MANAGEMENT_ARCHITECTURE.md` §3 | Depends on JWT signing (above) | ✅ **IMPLEMENTED** (Phase 2D.1 — `GET /.well-known/jwks.json`; independently exercised by Phase 2D.4's own e2e suite — live fetch + `jwt.verify()`, not merely decoded) |
| Key rotation | `docs/KEY_MANAGEMENT_ARCHITECTURE.md` §4 — scheduled + emergency, overlap window | Depends on JWKS (above) | ✅ mechanism **IMPLEMENTED** (`OAUTH_RETIRED_PUBLIC_KEYS`, Phase 2D.1); the operational rotation runbook itself remains a future procedure |
| Client model | ADR-018 (as corrected) — Application extended, no split | None | ✅ **IMPLEMENTED** (Phase 2D.2 — `grantTypes`/`allowedScopes`/`audiences`/`tokenEndpointAuthMethod` columns + policies, `docs/PHASE_2D2.md`) |
| Client credentials | ADR-006 (existing) + ADR-018 — Application/ServiceAccount, `client_secret_basic`/`_post` | Depends on client model (above) | ✅ **FULLY IMPLEMENTED** (Phase 2D.2 configuration foundation + Phase 2D.3 `ServiceAccount` identity/credential model + Phase 2D.4 the `client_credentials` grant flow itself, `docs/PHASE_2D4.md`) |
| Service authorization | ADR-015 (as amended) — `ServiceAccountTenantGrant`, hybrid model, resolved this gate | New `ServiceAccount`/`ServiceAccountTenantGrant` storage | ✅ **IMPLEMENTED** (Phase 2D.3 — both tables, full lifecycle, `docs/PHASE_2D3.md`; validated end-to-end by a real token request as of Phase 2D.4) |
| Organization context | ADR-019 — hint-only, reuses Phase 2C's existing validation, resolved this gate | None — Phase 2C mechanism already built | ✅ |
| Tenant authorization | ADR-015 — layered under `TenantProductEntitlement`, resolved this gate | Depends on service authorization (above) | ✅ **FULLY IMPLEMENTED** (Phase 2D.3's `ServiceAccountTenantGrantsService.isGrantActive()` is now actually called by `POST /oauth/token`'s composed eligibility chain, Phase 2D.4, `docs/PHASE_2D4.md`) |
| Scopes | ADR-016, `docs/APPLICATION_AUTHORIZATION.md` §5 — namespaced identically to permissions | None | ✅ **IMPLEMENTED** (Phase 2D.2 — `ApplicationScopePolicy`) |
| IAM permissions | ADR-004 (existing, unchanged) — product-local enforcement | None — pre-existing, unaffected | ✅ **CONTRACT IMPLEMENTED** (Phase 2D.6 — `ResourceAuthorizationPolicy`, the seam a product plugs its own IAM into; Identity Platform ships zero product permission implementations, `docs/PHASE_2D6.md`) |
| Product entitlement | ADR-011 (existing, unchanged) — `ProductAccessService`, local-or-live per product's choice | None — pre-existing, unaffected | ✅ **now composable at the resource-authorization layer** (Phase 2D.6 — a product's own policy may call the unchanged `ProductAccessService.canAccess()`; never automatic, `docs/PHASE_2D6.md` §"genuine architectural finding") |
| Resource servers | ADR-020 — 11-step pipeline, fully ordered, fully specified | Depends on JWKS + audience registration | ✅ **steps 1-7 IMPLEMENTED** (Phase 2D.5 — `ExternalAccessTokenValidator`/`JwksClientService`/`ExternalBearerAuthGuard`, `docs/PHASE_2D5.md`; Phase 2D.7 extended the validator to distinguish `USER` from `SERVICE_ACCOUNT` principals via an explicit `principal_type` claim, with zero behavior change for any pre-existing machine token, `docs/PHASE_2D7.md` §15); ✅ **steps 8-9's CONTRACT (not any product's implementation) now exists** (Phase 2D.6 — `ResourceAuthorizationPolicy`/`ResourceAuthorizationGuard`, `docs/PHASE_2D6.md`, unmodified by and fully compatible with the new USER principal type); step 11 (tenant-scoped data access, each product's own RLS/isolation) remains, correctly, entirely product-owned and out of scope for Identity Platform to provide |
| Refresh tokens | Existing Phase 1–2C mechanism, reused as-is | None | ✅ |
| Revocation | `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §2 `/revoke` — RFC 7009 semantics specified | Depends on token endpoint (above) | ✅ |
| Introspection | `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §2 `/introspect` — exception path, not default, explicitly scoped | Depends on token endpoint (above) | ✅ |
| Migration | Gate 10, above — no migration required, purely additive | None | ✅ |

Every row is READY: each decision above is precise enough that an implementer would not need to invent a new security-critical choice while coding it — the remaining work is building exactly what is specified, in the order `docs/PHASE_2D_ARCHITECTURE.md` §6 already lays out.
