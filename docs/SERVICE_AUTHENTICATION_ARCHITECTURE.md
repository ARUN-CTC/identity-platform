# Service-to-Service Authentication Architecture

Detail document for ADR-006 (mechanism, already decided) and ADR-015 (tenant/scope authorization, this phase's new decision).

## 1. The service principal is not a human

A service (TravelOS's own backend calling the Identity Platform with no end-user present; a background worker; a webhook processor) authenticates as **itself**, never as a borrowed or synthetic human identity. Concretely:

```text
TravelOS API
     │  client_credentials grant
     │  (client_id + client_secret, or JWT client-assertion)
     ▼
Identity Platform  ──validates──▶  ServiceAccount (future entity)
     │
     │  Service Access Token
     │  sub = ServiceAccount.id  (never a security_user.id)
     │  client_id = Application.clientId
     │  aud = target resource API
     │  scope = service scopes
     ▼
Document Intelligence API (resource server)
```

`ServiceAccount` is a new, future conceptual entity (not built in Phase 2D) — the service's own principal identity, analogous to `security_user` for humans, referencing the `Application` it authenticates through (ADR-018). No `security_user` row is ever created to represent a service; no service token's `sub` is ever a `security_user.id`.

## 2. Client identity, scopes, audience

- **Client identity**: the presenting `Application`'s `clientId` — unchanged mechanism from Phase 2B.
- **Scopes**: service-specific, distinct from human OAuth scopes and from IAM permissions (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md` §Scope catalog) — e.g. `documentintel.process`, `travelos.sync.read`.
- **Audience**: the specific resource API the service intends to call, exactly as for human tokens (ADR-016) — a service token minted for `documentintel-api` is never valid against `travelos-api`.

## 3. Token lifetime

Short — the same order of magnitude as a human access token (minutes, not hours), since a compromised service credential's blast radius is bounded by how quickly its already-issued tokens expire, and since a service can always request a fresh one (no user interaction required, unlike a human re-login).

## 4. Credential storage, rotation, revocation

Unchanged mechanism from Phase 2B's existing `Application` credential handling: `client_secret` is shown once at creation/rotation, stored only as a hash (`clientSecretHash`), never recoverable. Rotation follows the same overlap-window pattern already designed (`secretCreatedAt`/`secretRevokedAt`) — a new secret is issued while the old one remains valid for a bounded grace window, then explicitly revoked, never silently. Full lifecycle: `docs/APPLICATION_AUTHORIZATION.md` §Credential lifecycle (applies identically to service-bearing Applications).

## 5. Service tenant authorization (ADR-015)

A valid `client_id`/`client_secret` proves *which service is calling* — it never implies *which tenants it may act on*. See ADR-015 for the full option analysis; the decision:

```text
Service Access Token (tenant-neutral — no tenant_id/organization_id claim)
        +
Request-time tenant assertion (the caller states which tenant, per-request —
        never assumed, never embedded in the token)
        +
ServiceAccountTenantGrant (durable, Platform-Operator-managed, revocable row
        naming exactly which (ServiceAccount, Tenant) pairs are authorized)
        +
TenantProductEntitlement (unchanged, ADR-011 — the tenant must still be
        entitled to the Product at all, independent of the service grant)
        ↓
   Service request authorized for THIS tenant
```

A leaked service credential is bounded by its own `ServiceAccountTenantGrant` rows — revocable independently and immediately, without rotating the credential itself, and auditable per-tenant.

## 6. Audit attribution

Every service-issued token and every tenant-scoped service action is audited with the `ServiceAccount` as the actor (never a human `actorUserId` borrowed for the occasion) — mirroring the `security_event.scope` discriminator already built for Platform Operator actions (Phase 2B.1) rather than inventing a new attribution mechanism.

## 7. Platform Operator interaction — registration, not membership

Platform Operators (ADR-010, unchanged boundary) perform every administrative action around service trust:

```text
register Applications          (existing capability, extended with grant-type/scope config)
manage clients/credentials     (existing capability)
manage scopes                  (NEW admin surface, future)
manage products                (existing capability, unchanged)
manage ServiceAccountTenantGrant (NEW admin surface, future — ADR-015)
manage trust relationships      (the sum of the above)
```

None of this makes a Platform Operator an organization member, and none of it grants a Platform Operator the ability to act *as* a tenant's own service or *as* a human user — administering a `ServiceAccountTenantGrant` row is a platform-level configuration action, structurally identical to administering a `TenantProductEntitlement` row today (Phase 2B.2), and carries the same non-negotiable separation Phase 2B.1 established: Platform Operator authority and tenant-scoped Membership remain two entirely independent grants on a global Identity, never derived from one another. **No impersonation mechanism is introduced anywhere in this design** — a Platform Operator can grant or revoke a service's *right* to act on a tenant, but never assume that service's identity, and never assume a human's. This is now a platform-wide, unconditional rule, not a Platform-Operator-specific callout — see ADR-021 for the full impersonation/token-forwarding boundary (also prohibited: a service simply relaying a human's own access token to a downstream service instead of authenticating to it with its own `ServiceAccount` credential — the "confused deputy" entry in `docs/PHASE_2D_THREAT_MODEL.md`).

## 8. What is explicitly NOT built by this document

`ServiceAccount`, `ServiceAccountTenantGrant`, the scope-management admin surface, and the client_credentials `/token` grant itself do not exist today. Sequenced at `docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap 2D.9–2D.10.

## 9. Implementation status (Phase 2D.3, `docs/PHASE_2D3.md`)

**`ServiceAccount` and `ServiceAccountTenantGrant` are now implemented** (`src/modules/service-accounts/`), exactly as designed above: a `ServiceAccount` belongs to exactly one `Application` (`Application 1───N ServiceAccount`), authenticates with its own credential (SHA-256-hashed, one-time plaintext reveal — a distinct secret from its owning Application's own `client_secret`, never derived from or combined with it), and holds zero implicit tenant access; a `ServiceAccountTenantGrant` is the sole, explicit, durable authorization record layered underneath the unchanged `TenantProductEntitlement` check (§6's Gate 4 hybrid model, reaffirmed and now built). The admin surface for `ServiceAccountTenantGrant` (create/list/get/patch/reactivate) is implemented, tenant-first nested (`/platform/tenants/:tenantId/service-account-grants`) — the scope-management admin surface referenced in §8 above is not part of this and remains unbuilt. `ServiceAccountTenantGrantsService.isGrantActive()` is the narrow, live-read integration point a future Client Credentials `/token` pipeline will call; no such pipeline, no `/token` endpoint, and no composed multi-table eligibility check exist yet.

## 10. Implementation status (Phase 2D.4, `docs/PHASE_2D4.md`)

**`POST /oauth/token` (`grant_type=client_credentials`) is now implemented** (`ClientCredentialsService`, `src/modules/oauth/services/`) — the pipeline diagram in §1 above is now real, executable code: an Application authenticates with `client_secret_basic`, then the specific `ServiceAccount` acting through it authenticates with its **own** credential (`credential_hash`, §9 above), then `ServiceAccountTenantGrantsService.isGrantActive()` (§9's own integration point) validates the explicit tenant assertion, then `ProductAccessService.canAccess()` (Phase 2B.2, reused unchanged) validates entitlement + product status, then `ExternalTokenService.sign()` (Phase 2D.1) issues the token. §2's claim shape is unchanged: `sub = ServiceAccount.id`, `client_id = Application.clientId`.

**Note on §1's authentication line** ("authenticates via OAuth2 client-credentials using that Application's own `client_id`/`client_secret`"): this sentence, and the closely related text in `docs/PRODUCT_REGISTRATION.md` §2.4 and ADR-018's restored decision, describe the *Application*-level authentication step only — they predate, and were never updated to reflect, Phase 2D.3's own schema decision to give `ServiceAccount` a **mandatory** credential of its own (`credential_hash`, `NOT NULL`, one-time-reveal — a real, provisioned, already-tested secret, not a speculative or unused column). Phase 2D.4 follows the actual, running schema rather than silently working around it or silently rewriting this historical text: a token request authenticates the Application (`client_secret_basic`) **and separately** authenticates the specific `ServiceAccount` (its own `credential_hash`) — two independent secrets, verified independently, never combined or derived from one another. See `docs/PHASE_2D4.md`'s own "Architecture decisions resolved this phase" §1 for the full reasoning. §4's audit attribution model (ServiceAccount as actor, never a borrowed human `actorUserId`) is implemented exactly as designed, via `metadata`/`resourceId` rather than the `security_event.actor_user_id` column — that column has a hard FK to `security_user(id)`, which neither an `Application` nor a `ServiceAccount` is a row in.
