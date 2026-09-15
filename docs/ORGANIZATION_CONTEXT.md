# Organization Context

Phase 1 deliberately excluded organization-context switching but left `SecuritySession.organizationId` in the schema anticipating it. This document decided the architecture (Option D, below); Phase 2C (`docs/PHASE_2C.md`, `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`, `docs/adr/ADR-012-organization-context.md`) has since implemented it. This document is kept as-is, as the record of the design decision — the implementation docs above are the place to look for what was actually built, including the one refinement implementation required: §4a's open question is resolved in ADR-012's "Consequences" (organization context lives on `SecuritySession`, never on the global Identity, which is what makes the question moot rather than answered either way — access is always gated by live Membership/Organization/Tenant status, never by an account-level suspension flag this design never introduced).

## 1. The scenario

A user (Identity) holds Memberships in Organization A and Organization B (same Tenant, or — after the global-identity change in `docs/IDENTITY_DOMAIN_MODEL.md` §2.1 — different Tenants entirely). They log into a product. Which organization is "active"? Can they switch mid-session? Does authorization recalculate? Does the token change?

## 2. Options considered

### Option A — Organization embedded permanently in the access token, fixed at login

The user picks an organization at login; every token for that session forever reflects only that organization. Switching requires a full re-login.

- **Benefits**: simplest possible implementation; token is self-contained; no mid-session recalculation logic.
- **Drawbacks**: terrible UX for anyone genuinely managing multiple organizations day-to-day (a support agent, a consultant, a multi-brand owner) — forces logout/login to switch context.
- **Security**: fine, no different from single-org today.
- **Complexity**: lowest.
- **Scalability**: fine.

### Option B — Organization context selected purely through API/session state, never in the token

The active organization lives only server-side (on the Session row); every request, the product calls back to the Identity Platform (or the Identity Platform's guard, if colocated) to resolve "what organization is this bearer currently acting in."

- **Benefits**: switching is instant and centrally consistent; no token to reissue.
- **Drawbacks**: every request now needs a live call/lookup against Session state — reintroduces exactly the kind of per-request network dependency the token model exists to avoid; breaks products that want to validate a token fully offline (JWKS-only).
- **Security**: fine.
- **Complexity**: moderate (a resolution call/cache on every request).
- **Scalability**: worse — couples request throughput to Identity Platform availability/latency for every single call, not just login/refresh.

### Option C — Separate token/session per organization

Logging into Organization A and Organization B concurrently are two independent Sessions with two independent token pairs; the user (or client app) holds multiple token pairs simultaneously and picks which to send per-request.

- **Benefits**: token content is always accurate for the org it names; no mid-session recalculation.
- **Drawbacks**: pushes "which organization am I in" bookkeeping onto every client app (mobile/web) having to juggle multiple credential sets; "switch organization" becomes "manage multiple concurrent logins," which is not how any mainstream product's UX works and is confusing for end users.
- **Security**: fine, arguably cleaner isolation (a leaked token for Org A's context can't even superficially imply anything about Org B).
- **Complexity**: highest for client implementers; lowest for the Identity Platform itself.
- **Scalability**: fine server-side; poor from an integration-ergonomics standpoint (every SDK has to expose multi-session juggling).

### Option D — Hybrid: session-level active organization, reflected into a short-lived token, switch = new token

The Session (server-side) holds the current active `organization_id`, mutable via an explicit switch endpoint. Every access token minted for that Session (at login or refresh) carries the Session's *current* `organization_id` at time of issuance. Switching organizations updates the Session and immediately triggers a fresh access-token issuance (not a full re-login) reflecting the new organization; the previous access token remains technically valid until its (short) natural expiry, which is the same bounded staleness window already accepted for the roles/permissions claims in `docs/TOKEN_ARCHITECTURE.md` §6.

- **Benefits**: tokens stay fully self-contained/offline-verifiable (keeps Option A's strength); switching is fast (one endpoint call, no re-login) and centrally recorded (keeps most of Option B's UX); no client-side multi-session juggling (avoids Option C's integration burden).
- **Drawbacks**: a short window (bounded by access-token TTL, already short for other reasons) where an in-flight old token still reflects the pre-switch organization — acceptable because it mirrors the staleness window Phase 2 already accepted for roles/permissions, and is far shorter than Option A's "until logout."
- **Security implications**: switching is itself an authorization-relevant event (must re-validate the Identity actually holds a Membership in the target Organization) and should be its own audited action (`SecurityEvent(ORGANIZATION_CONTEXT_SWITCHED)`).
- **Complexity**: moderate — one new endpoint, one new token-issuance path reusing the existing refresh-token-rotation machinery (a switch is implemented as "rotate now, with a new organization_id" rather than a bespoke mechanism).
- **Scalability**: same as normal refresh — no new per-request dependency.

## 3. Decision: Option D (Hybrid)

Chosen because it is the only option that avoids both of Option A's UX cost and Option B's per-request availability coupling, at a complexity cost that is genuinely small (it reuses the refresh/rotation pipeline that already exists). Recorded in `docs/adr/ADR-002-tenant-organization-model.md` (organization-context is a corollary of the tenant/org model decision) and referenced from `docs/adr/ADR-003-token-strategy.md`.

## 4. Mechanics

```text
POST /v1/auth/context/switch { organization_id }
  Authorization: Bearer <current access token>
     │
     ├── Verify caller has an active Membership in target organization_id
     ├── Update Session.organization_id
     ├── Rotate: issue new access token (organization_id = target) + new refresh token
     ├── Record SecurityEvent(ORGANIZATION_CONTEXT_SWITCHED, from, to)
     ▼
   { access_token, refresh_token }
```

`GET /v1/organizations` (already in the Phase 1-recommended API surface) returns the caller's full list of reachable Organizations so a client can render a switcher without guessing.

## 4a. A related open question, surfaced by the Phase 2A implementation (resolved — see ADR-012)

Phase 2A (`docs/PHASE_2A.md`) implemented global Identity + Membership and, in doing so, surfaced a question this document should eventually resolve alongside "which organization is active": **should suspending/deactivating an Identity's account be global (affects every Tenant/Organization it belongs to) or scoped to the acting admin's own Tenant?** Today (Phase 2A) it is global, by inheritance from Phase 1's account-lifecycle mechanism, which was never designed with more than one tenant per user in mind. A tenant-scoped admin action (`MembershipsController`'s status endpoint, `PATCH /organizations/:organizationId/members/:userId`) already exists as the correctly-isolated alternative for "remove this person from my organization" — but a genuine account-level suspension (e.g., a compromised credential) still has global reach today, which may or may not be the intended semantics once organization-context switching makes multi-tenant Identities a normal, expected case rather than an edge case. Resolve this explicitly when this document's Option D mechanics are actually implemented (Phase 2C), not by further silent inheritance from Phase 1.

## 5. Can a token represent multiple organizations at once?

No — deliberately. A token names exactly one `organization_id` (or `null` for the tenant-wide/no-selection case). Multi-organization *visibility* (e.g. an admin dashboard listing all organizations a user manages) is served by API calls scoped by the *core* `identity.organization.read` permission across whichever organizations the caller's grants cover — that is a query concern, not a token-shape concern, and is exactly why fine-grained checks are pushed server-side rather than baked into the token (`docs/TOKEN_ARCHITECTURE.md` §6).
