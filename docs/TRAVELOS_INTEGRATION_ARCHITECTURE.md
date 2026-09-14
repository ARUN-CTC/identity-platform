# TravelOS Integration Architecture

Phase 2E.1. The target architecture for TravelOS consuming Identity Platform V1 (`identity-platform-v1.0.0`, frozen — `docs/API_SECURITY_CONTRACT_FREEZE.md`). Built on the real findings in `docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md` and the mapping in `docs/TRAVELOS_IDENTITY_MAPPING.md`. This document does not redesign Identity Platform V1 — every capability it relies on already exists and is frozen.

## 1. Ownership split (unchanged from Identity Platform's own frozen contract)

```text
Identity Platform owns:                         TravelOS owns/keeps:
  Authentication, identity, sessions               TravelOS business entities (bookings, quotations, ...)
  OAuth/OIDC, token issuance/validation             TravelOS business roles/permissions (TRAVEL_*, etc.)
  Tenant identity, organization identity/context    TravelOS Organization ERP fields (cost centers, fiscal years)
  Product entitlement (the fact)                    TravelOS's own feature-flag/subscription layer
  ServiceAccount identity, cross-product trust       TravelOS product configuration
  Security audit (identity-layer events)            TravelOS business audit (booking/quotation events)
```

This is `docs/PRODUCT_INTEGRATION_CONTRACT.md` §1, restated for this one product. Nothing here moves TravelOS business authorization into Identity Platform, and nothing gives Identity Platform new awareness of bookings/quotations/customers.

## 2. Authentication migration option evaluation (brief §20)

| | A. Big Bang | B. Dual Authentication | C. Identity Platform Front Door | D. Strangler (cohorts) |
|---|---|---|---|---|
| Security | High risk — single irreversible moment, no fallback if a defect surfaces post-cutover | Two trust boundaries live simultaneously — each must be independently correct; risk of one being weaker | Cleanest end-state; TravelOS never re-implements auth, only validates | Same end-state as B/C, reached gradually — smaller blast radius per step |
| Complexity | Low to build, high to de-risk | Highest — two auth code paths coexist, both must be maintained correctly | Moderate — TravelOS still needs its own resource-server validation | Moderate, spread over time |
| Rollback | Very hard — all users already cut over | Easy — legacy path still there | Easy until legacy path is actually removed | Easiest — only the current cohort is at risk at any moment |
| Downtime | Requires a coordinated moment | None | None | None |
| Migration risk | Concentrated, all-at-once | Spread but doubled (two systems) | Spread, single target system | Spread, single target system, smallest increments |
| User experience | One forced re-login for everyone at once | Confusing if both paths are ever simultaneously reachable by the same user | One re-login, staged | One re-login per cohort, staged |
| Data consistency | Must be perfect before the single cutover moment | Requires the reconciliation map (§ mapping doc) to be correct from day one of dual auth | Same | Same, but only for the active cohort at any time |
| Operational burden | Short, intense | Sustained (two systems to operate) | Lower once cutover completes | Sustained until the last cohort, then drops |

**Recommendation: Option D (Strangler / cohort migration), implemented via the mechanics of Option C as the end state.** Concretely: TravelOS's OWN authentication endpoints stay in place during a coexistence window (satisfying "we must coexist with the current TravelOS authentication temporarily," brief §14) while NEW/migrated tenants are provisioned directly against Identity Platform; each cohort's users are cut over to Identity-Platform-issued tokens on their own schedule (never a single flag-day for the whole tenant base), and TravelOS's resource-server code becomes a normal `docs/RESOURCE_SERVER_ARCHITECTURE.md`-pattern consumer of Identity Platform the moment ANY cohort is live — the validation code is not itself per-cohort, only which USERS currently hold Identity-Platform-issued vs. legacy tokens is. Legacy TravelOS authentication is retired only after the last cohort completes (Phase 2E.6). This is a recommendation for 2E.2+ to execute, not something built in this phase.

## 3. Target architecture

```text
                         Identity Platform V1 (frozen)
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
             USER          SERVICE ACCOUNT       PLATFORM OPS
        (TravelOS web/admin  (TravelOS backend        (Identity Platform's own
         SPA end users)       jobs, IF any exist        administration — never
                               — inventory §17           TravelOS's concern)
                               UNKNOWN, TBD in 2E.2)
              │                   │
          OAuth/OIDC       Client Credentials
       (Authorization Code    (only if a real
        + PKCE, S256)          machine-caller
              │                 need is confirmed)
              └───────────┬───────┘
                          ↓
                    Access Token (RS256, Identity Platform's JWKS)
                          │
                          ↓
                    TravelOS Backend (Resource Server)
                          │
            ┌─────────────┼─────────────┐
            ↓             ↓             ↓
          Tenant       Organization    Scope
       (token's own   (token's own    (travel.read /
        tenant_id,     organizationId, travel.write —
        authoritative) validated,      §7 below)
                        never a header)
            │             │             │
            └─────────────┼─────────────┘
                          ↓
              TravelOS Product Entitlement
          (TenantProductEntitlement — Identity Platform DATA,
           checked at token issuance; TravelOS's own live
           re-check optional, same seam every other product uses)
                          ↓
                TravelOS IAM (UNCHANGED)
        (PermissionsGuard / resolveGrants(), TRAVEL_* permissions,
         organizationId-scoped exactly as it already works today)
                          ↓
                 TravelOS Business
           (bookings, quotations, customers — untouched)
```

**Ownership boundary marked explicitly**: everything above "TravelOS IAM" is Identity Platform's; "TravelOS IAM" and everything below it is TravelOS's own, running its OWN, ALREADY-EXISTING `PermissionsGuard`/`resolveGrants()` code, now fed by a validated Identity Platform principal instead of a TravelOS-issued JWT. **No change to TravelOS's own authorization logic is required** — only to what identity/tenant/organization facts feed into it, and where those facts come from.

## 4. Resource server integration (brief §28)

TravelOS's backend becomes a standard Identity Platform resource server, following the EXACT pattern `docs/RESOURCE_SERVER_ARCHITECTURE.md` already defines and `src/modules/resource-server/` already reference-implements (Identity Platform's own in-process demo/test code is the pattern TravelOS's own, separate-process implementation must replicate in its own stack):

```text
TravelOS Request
   ↓
Bearer extraction (RFC 7617-adjacent)
   ↓
JWKS-based signature verification (fetch from Identity Platform's GET /.well-known/jwks.json — never TravelOS's own embedded key, never Identity Platform's database)
   ↓
Issuer check (Identity Platform's OAUTH_ISSUER)
   ↓
Audience check (TravelOS's own registered audience — §7 below — never *, never travelos-api's OLD self-issued meaning)
   ↓
Temporal validation (exp/nbf)
   ↓
AuthenticatedPrincipal construction (docs/contracts/principal-contract-v1.schema.json shape)
   ↓
Tenant context (principal.tenantId — authoritative; TravelOS's OWN existing RLS/current_tenant_id() mechanism is set FROM this, never from a client header)
   ↓
Organization context (principal.organizationId — same rule)
   ↓
TravelOS's OWN, UNCHANGED PermissionsGuard / resolveGrants() / TRAVEL_* permission checks
   ↓
Business operation
```

**TravelOS must NOT query the Identity Platform database** (absolute isolation rule; also structurally impossible cross-process/cross-repo) and **must NOT validate tokens using Identity Platform private keys/secrets** — only the published public JWKS, per the frozen contract. This mirrors `docs/SDK_BOUNDARY.md`'s own description of what any real, separate resource server must independently implement.

## 5. ID Token vs. Access Token (brief §29)

```text
TravelOS web/admin frontend  →  OIDC ID Token  →  client-side identity display only, NEVER sent to TravelOS's own API
TravelOS backend API         →  OAuth Access Token  →  the only bearer credential TravelOS's resource server ever accepts
```

Structurally enforced by Identity Platform's own frozen invariant (`token_use` claim, `docs/API_SECURITY_CONTRACT_FREEZE.md` §4) — TravelOS's resource-server validation code inherits this rejection automatically by following the standard validation pipeline in §4 above; no TravelOS-specific extra check is needed, but TravelOS's own implementation MUST include the `token_use` check (it is not optional/implicit — a naive implementation that only checks signature/issuer/audience would NOT reject an ID Token on its own).

## 6. UserInfo (brief §30)

If TravelOS's frontend needs OIDC profile/email claims beyond what it already has locally (name, email — TravelOS's own `SecurityUser` already has these post-reconciliation), it calls `GET /oauth/userinfo` with the Access Token, per `docs/PRODUCT_INTEGRATION_CONTRACT.md` §8. TravelOS's backend never reaches into Identity Platform's own database to fetch identity claims.

## 7. Audience and scope design (brief §26-27)

**Audience**: TravelOS's multi-product internal structure (inventory §13) means one audience per internal product, not one audience for the whole deployable:

```text
travelos-travel-api        — the Travel product's own API
travelos-healthcare-api    — the Healthcare product's own API (if/when it goes through this integration)
travelos-fitness-api       — the Fitness product's own API (if/when it goes through this integration)
```

Never `*`, never `all`, never a single shared "travelos-api" audience spanning all three (the CURRENT self-issued `JWT_AUDIENCE=travelos-api` explicitly does span all three today — this is a change TravelOS's own team must approve, since it affects TravelOS's own deployment topology, but Identity Platform's own frozen contract requires distinct explicit audiences per product per `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §5). Exact production values are NOT invented here — a real deployment convention (e.g. `https://api.travelos.<real-domain>` per product) must be confirmed with TravelOS's own operators before 2E.2 registers any real `Application`.

**Scope taxonomy (proposed, NOT implemented this phase)**:

```text
travel.read     — read-level API capability for the Travel product
travel.write    — write-level API capability for the Travel product
healthcare.read / healthcare.write   — same pattern, if/when integrated
fitness.read / fitness.write         — same pattern, if/when integrated
openid, profile, email               — standard OIDC scopes, for the human/OIDC flow only
```

Scopes gate API-CAPABILITY-CLASS access (can this token even attempt a read/write against this product's API at all) — they are NOT a substitute for TravelOS's own `TRAVEL_BOOKING_CONFIRM`-style fine-grained IAM permissions, which remain entirely TravelOS's own, unchanged concern, checked AFTER the scope layer, exactly as `docs/PRODUCT_INTEGRATION_CONTRACT.md` §5's decision chain already specifies.

## 8. Application topology (brief §25)

| TravelOS component | Identity Platform registration | Grant type |
|---|---|---|
| `apps/web` (tenant-facing SPA) | Application, `clientType=PUBLIC` | `authorization_code` + PKCE S256 |
| `apps/admin` (admin SPA) | A SEPARATE Application (own `client_id`) — different trust level, never shared with `apps/web` | `authorization_code` + PKCE S256 |
| `apps/backend` (resource server) | No Application/ServiceAccount needed to VALIDATE tokens (JWKS-only) | N/A |
| `apps/backend` scheduled jobs/workers | ONLY if a real need is confirmed (inventory §17, currently UNKNOWN) | `client_credentials`, its own ServiceAccount |

None of these are registered in this phase — this table is the design a future 2E.2 implementation phase executes.

## 9. Organization context (brief §31)

TravelOS's own existing `X-Organization-ID`-style behavior (if any — not directly confirmed by this pass's discovery; TravelOS's `SecuritySession.organizationId` and JWT `organizationId` claim suggest server-embedded context, not a client header, matching Identity Platform's own posture) must, post-migration, follow the SAME rule Identity Platform already enforces: the validated principal's `organizationId` is authoritative; the earlier finding that TravelOS's `PermissionsGuard` already reads `context.organizationId` (server-derived, "never a client-supplied header" — inventory §2/§6, direct quote from `permissions.guard.ts`'s own comment) confirms TravelOS's OWN code already follows this discipline and needs no behavioral change here, only a change in WHERE `context.organizationId` gets populated from (Identity-Platform-issued token vs. TravelOS's own legacy session).

## 10. Logout (brief §32)

Identity Platform becomes the single, authoritative identity-session owner post-cutover. TravelOS's own frontend-initiated logout must, going forward, terminate the Identity Platform session/token (not merely clear TravelOS's own local refresh token as it does today, inventory §10) — the exact mechanism (Identity Platform token revocation endpoint, if any exists — **not confirmed as part of the frozen V1 contract; `docs/API_SECURITY_CONTRACT_FREEZE.md` names no `/revoke` endpoint as FROZEN** — see §11 Identity Platform V1 compatibility below) is a genuine gap requiring resolution before 2E.4, not invented here.

## 11. Identity Platform V1 compatibility — gaps found

No redesign of Identity Platform V1 is proposed. Two gaps were found where TravelOS's needs are not yet covered by the frozen v1 contract — both documented per the brief's own instruction ("document: Gap / Impact / Workaround / Future phase"), neither silently worked around:

| Gap | Impact | Workaround (2E.2-2E.6) | Future phase |
|---|---|---|---|
| No token revocation/`/revoke` endpoint in the frozen v1 contract | Explicit logout cannot immediately invalidate an already-issued, unexpired Access Token — TravelOS logout can only clear client-side storage and let the token expire naturally (short TTL bounds this) | Rely on short Access Token TTL (already the Identity Platform default, ~15 min) as the bound; document this explicitly to TravelOS's own users/ops as expected behavior, not a defect | A genuine `/revoke`/introspection capability, if ever built, is new Identity Platform scope — outside 2E's own remit to add unilaterally |
| No live, product-callable, cross-process entitlement-check HTTP endpoint (`docs/PRODUCT_INTEGRATION_CONTRACT.md` §9, already a documented FUTURE ARCHITECTURAL SEAM as of Phase 2D.10) | TravelOS cannot ask Identity Platform "is this tenant still entitled to TravelOS-Travel, right now" outside of re-requesting a token | Rely on the same re-issue-a-token-to-recheck pattern every other product already accepts (`docs/PRODUCT_INTEGRATION_CONTRACT.md` §5) | Already named as deferred/future in Phase 2D.10 — no NEW gap, just confirmed applicable to TravelOS too |

Neither gap is a security blocker; both are documented limitations with an accepted interim behavior, consistent with the brief's "if a genuine security blocker is discovered, stop and report it — otherwise document Gap/Impact/Workaround/Future phase" instruction.
