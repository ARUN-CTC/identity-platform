# ADR-022: TravelOS Identity Integration Strategy

## Context

Identity Platform V1 is frozen (`identity-platform-v1.0.0`, `docs/API_SECURITY_CONTRACT_FREEZE.md`). TravelOS is a real, separately-repositoried, separately-deployed product (`E:\wrkspc\travelOS\TravelPlatform\travelos`) with its own working authentication/authorization system, extracted-from lineage strongly matching Identity Platform's own Phase 1 origin (near-identical `security_*` schema, the same `apply_tenant_rls`/`NOBYPASSRLS` pattern, the same Argon2id password hashing, the same "never trust JWT role claims, re-resolve live" RBAC discipline — confirmed directly by source inspection, `docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md`). Phase 2E.1 must decide HOW TravelOS adopts Identity Platform as its authentication authority without redesigning either system.

## Current state (source-verified, not assumed)

- TravelOS's own JWT: already RS256, already asymmetric — but its OWN key, OWN issuer (`travelos`), OWN audience (`travelos-api`), no `scope`/`role`/`permission` claims.
- TravelOS's own password hashing: `argon2.hash(plain, {type: argon2.argon2id})`, identical call shape and default parameters to Identity Platform's own — directly portable, pending a verification spot-check.
- TravelOS's email uniqueness is PER-TENANT (not global) — a fundamental identity-model mismatch requiring reconciliation, not a straight copy.
- TravelOS has no `Membership` concept, no existing OAuth/OIDC implementation (the `oauth` module is an empty stub), no existing ServiceAccount/Application-equivalent for incoming machine callers.
- TravelOS is internally a three-product platform already (`travel`/`healthcare`/`fitness` under one backend) with its own `TRAVEL_`-prefixed business-permission catalog, already cleanly separated from identity-administration permissions in its own seed data.
- TravelOS's frontend is a pure bearer-token SPA (no cookies) — directly compatible with Identity Platform's own no-cookie design.

Full detail: `docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md`, `docs/TRAVELOS_IDENTITY_MAPPING.md`.

## Options considered

See `docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §2 for the full comparison table (security/complexity/rollback/downtime/migration risk/UX/data consistency/operational burden) across:
- **A — Big Bang**: all TravelOS tenants cut over simultaneously.
- **B — Dual Authentication**: both auth systems remain permanently coexistent.
- **C — Identity Platform Front Door**: TravelOS becomes a pure resource server, all human auth via Identity Platform.
- **D — Strangler (cohort) Migration**: TravelOS's legacy auth and Identity Platform coexist temporarily, cohorts cut over incrementally, legacy is retired only once every cohort has succeeded.

## Decision

**Adopt Option D (Strangler/cohort migration), converging to Option C's end state.** TravelOS's existing authentication stays live and untouched during a coexistence window; new/pilot tenants are provisioned directly against Identity Platform first; each existing tenant is cut over to Identity-Platform-issued tokens on its own schedule (never a single flag-day for the entire tenant base); TravelOS's resource-server validation logic is built once, to the Option C end-state pattern, and applied per-tenant via a cutover flag rather than built twice (once for a "transitional" shape and again for the "final" shape).

**Rationale**:
- **Security**: smallest blast radius per step — a defect discovered mid-migration affects one cohort, never the whole tenant base; no forced acceptance of TravelOS's own legacy tokens beyond an explicit, time-boxed, audited rollback window (never indefinite).
- **Availability**: zero platform-wide downtime is achievable (`docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md` §2) — every phase is additive or per-cohort.
- **Rollback**: reversible at every stage up to legacy shutdown (`docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md` §6), unlike Option A (irreversible once flipped) or Option B (never actually converges to a single, simpler end state).
- **Operational complexity**: higher than Option A in the short term (two systems coexist for a while), but bounded and shrinking — Option B's complexity is PERMANENT, which this decision explicitly rejects.
- **User experience**: each cohort re-authenticates once, on a schedule TravelOS's own team controls — no platform-wide forced-logout event.

## Security implications

- TravelOS's own, ALREADY-CORRECT authorization discipline (live `resolveGrants()`, never trusting JWT role claims) requires NO change — only what feeds `context.tenantId`/`context.organizationId` changes (from a TravelOS-issued JWT to an Identity-Platform-validated principal), not the authorization logic itself.
- The Phase 2D.6 boundary (Identity Platform never owns product/business permissions) is preserved exactly — TravelOS's `TRAVEL_*` permission catalog and its own `PermissionsGuard` remain entirely TravelOS-owned, unmodified.
- Identity Platform V1's frozen contract is NOT modified to accommodate TravelOS — two genuine gaps were found (no `/revoke` endpoint; no live cross-process entitlement-check endpoint) and are documented as accepted interim limitations (`docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §11), not silently worked around and not treated as blockers, since both already have a safe interim behavior (short TTL bounds revocation exposure; re-issuing a token re-checks entitlement).
- A full integration-specific threat model (`docs/TRAVELOS_INTEGRATION_THREAT_MODEL.md`, 20 threats) found no unmitigated Critical/High risk — the two ACCEPTED items (T10, a correct-behavior edge case; T16, a coexistence-window process gap) both have documented, actionable mitigations for 2E.2+.

## Migration implications

Nine new Identity-Platform-side rows/tables at most (`Tenant`, `Organization`, `Membership`, `Product`, `TenantProductEntitlement`, `Application` — all standard, already-existing Identity Platform entities — plus two migration-scoped mapping tables, `docs/TRAVELOS_IDENTITY_MAPPING.md` §4) — **zero Identity Platform schema/runtime change**, and **zero TravelOS change of any kind**, in this phase. Full phase-by-phase migration sequence in `docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md` §1 (14 phases, 2E.2 onward).

## Rollback

Defined per migration stage in `docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md` §6 — reversible through every stage up to legacy authentication shutdown (Phase 12/14), at which point rollback is intentionally no longer offered (by design, only reached after every earlier rollback window has been exhausted and an explicit sign-off given).

## Consequences

- TravelOS's own team must build: JWKS-based token validation (replacing self-issued-token verification), an Identity-Platform-aware login redirect in `apps/web`/`apps/admin`, and the per-tenant cutover flag — none of this is built by this phase.
- A future 2E.2 phase must confirm several items this phase left explicitly UNKNOWN (TravelOS's exact tenant `status` value set, whether any backend-to-backend ServiceAccount need actually exists, the full healthcare/fitness permission catalogs, real production audience-naming conventions) before registering any real `Application` or executing any real reconciliation.
- Identity Platform's own frozen v1 contract is unchanged — this integration consumes it exactly as documented, proving the contract freeze (Phase 2D.12) is sufficient for a real, independently-built product to integrate against without requiring Identity Platform's own team to make further architectural decisions mid-integration.
