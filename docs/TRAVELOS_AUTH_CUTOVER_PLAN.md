# TravelOS Authentication Cutover Plan

Phase 2E.1. The specific mechanics of moving authority from TravelOS's own JWT issuance to Identity Platform's, and the validation/rollback checklists a future 2E.4+ execution phase will run. Planning only.

## 1. Token migration window

```text
Stage 1 — Coexistence:
  TravelOS's resource-server validator accepts BOTH:
    (a) TravelOS-self-issued tokens (iss='travelos', TravelOS's own RS256 key) — for not-yet-cutover tenants
    (b) Identity-Platform-issued tokens (iss=<Identity Platform's own OAUTH_ISSUER>, Identity Platform's JWKS) — for cutover tenants
  Selection is per-tenant (the token's OWN tenant_id/iss decides which validation path applies —
  never a global flag), so both cohorts are served correctly by the SAME running TravelOS instance.

Stage 2 — Cutover (per tenant):
  That tenant's validator path flips to REJECT (a) and accept only (b).
  TravelOS's OWN login endpoint, for that tenant, stops issuing new (a)-shaped tokens —
  either by redirecting the tenant's login UI to Identity Platform's /authorize, or by disabling
  the tenant-scoped legacy login entirely, per whichever TravelOS's own team decides is the better UX.

Stage 3 — Legacy sunset:
  Once EVERY tenant is in Stage 2, path (a) validation code itself is removed from TravelOS
  (Phase 12 of the migration plan) — not merely unreached, actually deleted, closing the code
  path permanently rather than leaving a dormant, potentially-reactivatable vulnerability surface.
```

**Token lifetime bound**: because Access Token TTL is short (~15 min, both systems' current default), Stage 1→2 for any given tenant needs no explicit "wait for old tokens to expire" step beyond that TTL — a legacy token issued the moment before cutover naturally stops being presentable (it's still cryptographically valid, but the endpoint that could ACCEPT it for that tenant has already flipped) within 15 minutes. **This IS a hard cutover from TravelOS's own validator's perspective at the moment the flag flips** — a small window of already-in-flight legacy tokens may 401 mid-session for that tenant's active users, which is why the cutover moment should be scheduled for a low-traffic window per tenant even though no platform-wide downtime is required.

## 2. Revocation

Identity Platform's frozen v1 contract has no `/revoke` endpoint (`docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §11, documented gap) — an Identity-Platform-issued Access Token cannot be proactively invalidated mid-lifetime. TravelOS's own logout (post-cutover) therefore:
1. Clears client-side token storage (as it already does today, inventory §10).
2. Relies on the short TTL as the actual security bound for "how long can a stolen/leaked token be used after logout."
3. Documents this explicitly to TravelOS's own security/ops stakeholders as expected v1 behavior, not an oversight.

## 3. Password reset / account lifecycle ownership after migration (brief §33)

| Capability | Owner post-cutover | Notes |
|---|---|---|
| Password reset | Identity Platform | TravelOS's own `ForgotPasswordDto`/reset flow is retired at Stage 3 for that tenant |
| Email verification | Identity Platform (if Identity Platform has an equivalent — **UNKNOWN, requires confirmation**; TravelOS's own `emailVerifiedAt` column exists but the flow producing it wasn't directly read this pass) | Flag as an open item for 2E.2 |
| Account disable/lock | Identity Platform (`SecurityUser.status`) is authoritative for LOGIN capability; TravelOS's own `security_user.status` becomes informational/legacy only | See migration plan §3's "Revoked user" failure scenario — this requires an explicit coexistence-window process, not an automatic sync |
| Account deletion | Identity Platform, per its own existing lifecycle | TravelOS's own reconciled `SecurityUser` row (now superseded) is not deleted by this migration — it becomes dormant, retained for audit/rollback |

## 4. Invitations (brief §34)

TravelOS's `SecurityUserInvitationToken` flow is structurally identical to Identity Platform's own (inventory §14) — post-cutover, NEW user invitations for a cutover tenant are issued through Identity Platform's own invitation flow instead, targeting the tenant's already-reconciled `Tenant`/`Organization` rows. Existing, still-pending TravelOS invitations at the moment of a tenant's cutover need an explicit decision: honor them via TravelOS's legacy flow until they expire naturally (recommended — avoids silently breaking an in-flight invite), or proactively re-issue them via Identity Platform. **Recommendation: honor in-flight legacy invitations to natural expiry**, consistent with "never silently discard" throughout this plan.

## 5. Audit event split (brief §35)

```text
→ Identity Platform (identity-layer events):
    LOGIN, LOGOUT, PASSWORD_RESET, SESSION_CREATED, SESSION_REVOKED, ACCOUNT_LOCKED,
    MEMBERSHIP_CREATED (from reconciliation), ORGANIZATION_CONTEXT_SWITCHED

→ TravelOS (business-layer events, UNCHANGED):
    BOOKING_CREATED, BOOKING_CONFIRMED, BOOKING_CANCELLED, QUOTATION_*, INQUIRY_*,
    and the not-yet-enumerated healthcare/fitness equivalents (inventory §17)
```

No duplication: once a tenant is cut over, TravelOS's own `security_login_attempt`/`security_event` tables stop receiving NEW identity-layer rows for that tenant (the events simply don't occur in TravelOS anymore — Identity Platform is where the login happened) while continuing to receive business-layer events exactly as today. Pre-cutover history in TravelOS's own tables is retained, not migrated into Identity Platform's audit store (a business record of what TravelOS itself did, not something Identity Platform needs to own retroactively).

## 6. Validation checklists (brief §49 — architecture-only; these are plans, not yet executed)

### Migration validation checklist (per tenant, before declaring that tenant's reconciliation complete)
```text
[ ] Every SecurityUser row for this tenant has a travelos_user_identity_map row with status RECONCILED or an explicitly accepted CONFLICT resolution
[ ] Every Membership created matches an actual TravelOS SecurityUserRole grant (no invented memberships)
[ ] TenantProductEntitlement reflects this tenant's ACTUAL TravelOS product subscription (never auto-ACTIVE)
[ ] Password-hash verification spot-check passed (§ migration plan §9's own recommended sample check) for this tenant's users
[ ] No TravelOS database row was modified (read-only source confirmed via a post-check diff/hash of the relevant tables)
```

### Contract validation plan
```text
[ ] TravelOS's resource-server implementation passes a conformance check against docs/contracts/identity-api-v1.json
    and docs/contracts/access-token-claims-v1.schema.json (structurally — does it reject a token missing a
    required claim, wrong aud, wrong iss, wrong alg, as documented)
[ ] TravelOS's resource-server rejects an ID Token presented as a bearer credential (§5 of the architecture doc)
[ ] TravelOS's resource-server never accepts a wildcard/multi-value audience (structurally impossible from
    Identity Platform's own issuance side, but TravelOS's OWN validator should not assume this — it should
    itself refuse to accept a token whose aud isn't its own exact registered string)
```

### Security test plan
```text
[ ] Legacy TravelOS token rejected once that tenant is in Stage 2 (§1)
[ ] Identity-Platform token rejected by a TravelOS instance not yet past Stage 1 for that tenant (expected — a
    coordination check, not a security defect, per migration plan §3's own failure-scenario table)
[ ] Cross-tenant token cannot access another tenant's TravelOS data (RLS + principal.tenantId, both layers)
[ ] Wrong-audience token (e.g. one issued for a different product) rejected by TravelOS's resource server
[ ] Suspended/revoked entitlement denies access even with an otherwise-valid token
[ ] All 20 threats in docs/TRAVELOS_INTEGRATION_THREAT_MODEL.md re-verified against the actual TravelOS
    implementation once built (2E.7, not this phase)
```

### Data reconciliation plan
```text
[ ] Profiling report (migration plan §4) reviewed and signed off by TravelOS's own team before any
    reconciliation row is created
[ ] Every CONFLICT-status row has a documented, human-reviewed resolution before that tenant's cutover
[ ] Reconciliation is idempotent — re-running phase 3-6 of the migration plan against the same TravelOS
    source data produces no duplicate rows (PK/unique constraints on the map tables enforce this)
```

### Cutover validation plan
```text
[ ] Pilot tenant completes a full login → API call → logout cycle via Identity Platform before any other
    tenant is scheduled
[ ] Error-rate monitoring shows no spike for the cutover tenant's traffic in the hour following flip
[ ] A sample of that tenant's real users confirms successful login post-cutover (not merely a synthetic test)
```

### Rollback validation plan
```text
[ ] The "re-enable legacy acceptance for one tenant" flag is itself tested (in a non-production environment)
    BEFORE it is ever relied upon in a real incident
[ ] Reverting a tenant's cutover does not orphan or duplicate any Membership/entitlement row
```

These checklists are the artifact this phase produces; EXECUTING them against a real TravelOS environment is explicitly out of scope for 2E.1 (brief §49: "Future implementation phases will execute these tests").
