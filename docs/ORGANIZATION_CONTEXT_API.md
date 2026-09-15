# Organization Context API

All routes below sit under the global `api/v1` prefix and require ordinary tenant-scoped authentication (`Authorization: Bearer <access token>`) — none of them are `@Public()`. See `docs/API_BOUNDARY.md` for the platform's general API conventions.

## `POST /v1/auth/context/switch`

Switches the caller's active organization context. The only client-supplied input.

**Request**
```json
{ "organizationId": "uuid" }
```

**Response `200`** — identical shape to login/refresh:
```json
{ "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": 900 }
```
The new access token's `organizationId` claim names the target organization; `tenantId`/`sessionId` reflect either the unchanged session (same-tenant switch) or a brand-new session in the target tenant (cross-tenant switch) — see `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` §5. The previous refresh token is revoked as part of this call; the previous access token remains valid only until its own natural (short) expiry.

**Response `403`** — `{ "message": "You do not have access to this organization" }`, for every one of: no Membership in that organization, a Membership that is not ACTIVE, a nonexistent organization, a disabled organization, or a suspended/cancelled tenant. See `docs/ORGANIZATION_CONTEXT_SECURITY.md` §3 for why these are deliberately indistinguishable.

**Response `401`** — missing/invalid/expired access token, or a revoked session (ordinary `JwtAuthGuard` behavior, unchanged).

## `POST /v1/auth/context/clear`

Returns the caller's session to tenant-wide context (no organization selected). No request body.

**Response `200`** — same shape as switch, with `organizationId` absent/`null` on the new access token.

## `GET /v1/me/organizations`

Lists every organization the caller could select via `context/switch` right now: every ACTIVE Membership this Identity holds, across every Tenant.

**Response `200`**
```json
[
  {
    "organizationId": "uuid",
    "organizationName": "string",
    "organizationStatus": "ACTIVE | INACTIVE",
    "tenantId": "uuid",
    "tenantCode": "string",
    "tenantName": "string",
    "tenantStatus": "PROVISIONING | ACTIVE | SUSPENDED",
    "membershipStatus": "ACTIVE"
  }
]
```
`membershipStatus` is always `"ACTIVE"` in this list by construction (non-ACTIVE memberships are excluded) — included for forward compatibility with a future "show me everything, including inactive" view, which this phase does not build. `organizationStatus`/`tenantStatus` are included so a client can grey out / explain an entry it cannot actually switch into, without a second round-trip.

## `GET /v1/me/context`

The caller's current tenant/organization context — a lightweight subset of `GET /auth/me`, for clients that only need the context switcher's own state (e.g. to render "currently acting as: Org A1 / Tenant DEV" in a header) without paying for `/auth/me`'s full roles/permissions payload.

**Response `200`**
```json
{
  "tenant": { "id": "uuid", "tenantCode": "string", "tenantName": "string" },
  "organizationContext": { "organizationId": "uuid | null", "organizationName": "string | null" }
}
```

## `GET /auth/me` (extended)

Unchanged shape, with one new field:

```json
{
  "user": { "...": "unchanged" },
  "tenant": { "...": "unchanged" },
  "organizationContext": { "organizationId": "uuid | null", "organizationName": "string | null" },
  "roles": [ "...": "now reflects the SELECTED organization's grants, not tenant-wide-only" ],
  "permissions": [ "..." ],
  "session": { "...": "unchanged" }
}
```

`roles`/`permissions` now resolve against `(tenantId, userId, organizationContext.organizationId)` — a Phase 2A limitation this phase fixes (previously, `GET /auth/me` only ever asked for tenant-wide grants, regardless of any organization context, because no organization context existed to ask about).

`organizationContext` itself is live-validated the same way `roles`/`permissions` are (Stabilization pass, see `docs/PHASE_2C.md` "Stabilization & Security Hardening") — it is not a blind echo of the access token's own claim. If the caller's Membership in that organization is no longer ACTIVE, or the Organization itself is no longer ACTIVE, `organizationContext` reports `{ organizationId: null, organizationName: null }`, identically to having no organization selected at all — never the stale organization's identity.

## Every other endpoint

No other endpoint's request/response contract changed. `PermissionsGuard` now resolves grants against the caller's currently-selected organization automatically, ambiently — no endpoint needed to be individually updated to "know about" organization context; this was a guard-level fix (`docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` §8), not a per-endpoint one.
