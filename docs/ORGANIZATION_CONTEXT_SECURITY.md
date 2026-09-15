# Organization Context Security

Threat model and security invariants for Phase 2C. Companion to `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` (mechanics) and `docs/SECURITY_ARCHITECTURE.md` (platform-wide model).

## 1. Trust boundary — what the client may assert, and what it may never assert

The client may assert exactly one fact in this entire feature: **"I want `organizationId` X to become my active context."** That is the sole input to `POST /v1/auth/context/switch` (`SwitchOrganizationContextDto` — one field, a UUID). The client may never assert, and no code path accepts as input:

- Which Tenant that organization belongs to (`AuthenticationService.switchOrganizationContext` resolves it server-side via `MembershipsRepository.findByUserAndOrgAnyTenant`, which is keyed to the caller's own authenticated identity — see architecture doc §4).
- That its Membership there is ACTIVE (re-checked live, every switch, every refresh).
- That the Organization or Tenant themselves are usable (`Organization.status`, `Tenant.status`, re-checked live, every switch, every refresh).
- Any role, permission, or entitlement — none of those are inputs anywhere in this feature; they are always outputs of server-side resolution (`UserRolesRepository.resolveGrants`).

A previously-issued access token's `organizationId` claim is a **convenience/identity fact**, presented back to the server by the client on every request via the `Authorization` header — but it is never itself treated as authorization. `PermissionsGuard` and `UserRolesRepository.resolveGrants()` re-derive Membership/Organization validity from the database on every call that makes an authorization decision; a forged or stale claim value cannot grant anything the database's own state doesn't independently confirm — worst case, a forged/stale claim simply resolves to the same "no organization-scoped grants" outcome as no claim at all.

## 2. Why the JWT claim is never trusted alone

Two independent facts can go stale between token issuance and token use, on a timescale a JWT's own signature validity says nothing about:

1. **Membership revocation** — an administrator removes/suspends the caller from an Organization *after* a token naming that Organization was already issued. The token remains cryptographically valid until its TTL expires; it does not know it has been superseded.
2. **Organization/Tenant disablement** — an Organization is set `INACTIVE`, or its Tenant `SUSPENDED`/`CANCELLED`, after the same point.

Both are covered: `PermissionsGuard`'s use of `resolveGrants()` re-checks Membership status and Organization status on **every** authorization-gated request (not just at token-refresh time) — the maximum exposure window for a stale grant is therefore zero at the authorization layer; the only place staleness can be *observed* at all is the token's own `organizationId` claim value between issuance and the next refresh, and that value is never used to make an authorization decision by itself. Refresh additionally clears a stale `organizationId` proactively (§3 of the architecture doc) so the claim itself self-heals within one TTL even for callers who never hit a permission-gated endpoint in between.

## 3. Enumeration resistance

`switchOrganizationContext()` returns the identical `403 Forbidden` ("You do not have access to this organization") for every one of: no Membership at all in that organization, a Membership that exists but is not ACTIVE (`INVITED`/`SUSPENDED`/`REMOVED`), an organization that does not exist, an organization that is `INACTIVE`, and a target Tenant that is `SUSPENDED`/`CANCELLED`. A caller cannot distinguish "that organization doesn't exist" from "it exists but you're not in it" from "it exists, you're in it, but it's disabled" — the same account/organization-enumeration defense `AuthenticationService.login()`'s `INVALID_CREDENTIALS` already applies is extended to context-switching.

## 4. Audit trail

Every switch attempt is audited, success or failure — never silent:

| Event | When | `tenantId` attribution |
|---|---|---|
| `organization_context.switched` | A switch succeeds (same- or cross-tenant) | The **target** tenant (the tenant the caller now operates in) |
| `organization_context.cleared` | An explicit clear succeeds | The caller's (unchanged) tenant |
| `organization_context.denied` | Any switch attempt fails validation | The caller's **current** tenant (the target may not even be a real, resolvable tenant) |
| `organization_context.cleared_stale` | A refresh discovers a previously-selected context is no longer valid | The caller's (unchanged) tenant |

Every event's `actorUserId` is the caller's own global Identity — never a synthetic or borrowed identity — and audit writes happen inline in the same request, awaited, never fire-and-forget: a failure to audit surfaces as a request failure rather than a silently-unaudited state change (same discipline `docs/PLATFORM_OPERATOR_ARCHITECTURE.md`'s audit model already established).

`organization_context.switched`/`.cleared` are recorded only AFTER every session mutation and token issuance for that operation has actually completed (Stabilization pass — the initial implementation recorded these before token issuance completed; fixed so a failure between the audit write and the response can never leave a `.switched`/`.cleared` event on record for an operation the caller did not actually receive working tokens for). `organization_context.denied` is recorded before the request fails, since a denial IS the final outcome — there is nothing further to wait on.

## 5. Security invariants (verified by `tests/phase2c-organization-context.e2e-spec.ts`)

1. A session starts with no organization context; no code path defaults it to anything else.
2. A client-supplied `organizationId` alone never grants access — every switch re-derives Tenant, Membership status, and Organization status from the database.
3. An `INVITED` or `SUSPENDED` Membership cannot be used to select that organization as context.
4. A disabled (`INACTIVE`) Organization cannot be selected as context, even with an otherwise-ACTIVE Membership.
5. A `SUSPENDED`/`CANCELLED` Tenant cannot be entered via cross-tenant switch.
6. A denied switch attempt never mutates the caller's existing session/context.
7. Every switch/clear reissues both tokens and revokes the prior refresh token — a stale token pair is never left simultaneously valid.
8. A same-tenant switch mutates the existing session (same `sessionId`); a cross-tenant switch always creates a genuinely new session and revokes the old one — the two are never conflated.
9. `GET /v1/me/organizations` lists only the caller's **own** ACTIVE memberships — the cross-tenant self-visibility RLS carve-out (architecture doc §4) is scoped to the connection's own authenticated `current_user_id()` and cannot be used to enumerate another user's memberships (verified directly — an outsider with no relationship to an organization cannot leverage another user's membership in it).
10. A Membership revoked, or an Organization disabled, mid-session is caught on the very next refresh — the selected context is cleared, not silently kept.
11. `PermissionsGuard` resolves organization-scoped grants only once that organization is the session's actual selected context (never "any organization the caller happens to belong to") — resolving `resolveGrants(tenantId, userId, organizationId)` with the wrong, unselected organization returns no organization-scoped grants for it.
12. Two concurrent switch requests on the same session, both to organizations the caller genuinely belongs to, both succeed without corrupting session state — the session lands on one of the two valid targets, never a mixed/partial value (Postgres's own per-statement atomicity on the `UPDATE`; no distributed-lock mechanism was needed, unlike Phase 2B.1's last-operator invariant).
13. `security_user.current_organization_id` was deliberately not created — organization context is per-session, so Browser A/Browser B/Mobile/API-client can each hold an independent, concurrent context for the same Identity without interference (verified structurally by the schema/design, not a runtime test — there is no shared mutable state to race on in the first place).
14. A disabled Organization's authorization grants stop resolving even while its Membership row remains ACTIVE (`UserRolesRepository.resolveGrants()`'s own Organization-status check) — but this narrowly withholds only *that organization's* scoped grants, never the caller's separate tenant-wide grants.

## 6. Non-goals (explicitly out of scope, not a security gap)

Product-boundary token validation (a downstream product enforcing `organizationId` against its own resource ownership) is out of scope for this phase — Phase 2C only guarantees the Identity Platform's own claim is trustworthy and re-validated; a consuming product must still perform its own authorization using the validated claim, exactly as `docs/TRUST_BOUNDARY.md` already specifies for every other claim in this token.
