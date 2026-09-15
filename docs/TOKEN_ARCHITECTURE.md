# Token Architecture

## 1. Which token types exist

| Type | Exists? | Rationale |
|---|---|---|
| Access Token | Yes (signed JWT) | Short-lived proof of authentication + minimal authorization context, validated locally by products |
| Refresh Token | Yes (opaque, rotated) | Long-lived session continuation; never sent to anything but the Identity Platform |
| ID Token | **Not yet** — reserved | Only meaningful once real OIDC is adopted (`docs/adr/ADR-007`); until then, `/v1/users/me` + the access token's identity claims serve the same purpose without a second token type to keep in sync |
| Session | Yes (server-side record) | Backs refresh-token rotation, revocation, device tracking, active-organization state |
| API Key | **Not as a separate primitive** — see §6 | Service-to-service use is served by ServiceAccount + client-credentials access tokens instead of a long-lived static key (see `docs/SECURITY_ARCHITECTURE.md`) |
| Service Account Credential | Yes (`client_id`/`client_secret` on the account's `Application`) | Used only to obtain a short-lived access token via client-credentials grant — the secret itself is never sent on every call |

## 2. Issuer

Always the Identity Platform, one signing authority for the whole multi-product platform. `iss` claim = the Identity Platform's own stable issuer URL (e.g. `https://identity.example.com`), constant across all products.

## 3. Audience

`aud` = the calling **Application**'s `client_id` (not the Product slug directly — a product can have multiple Applications, each a distinct audience, so a token minted for "TravelOS Web" is not valid if presented to "TravelOS Backend Service" unless that service explicitly accepts it). This is the fix for the Phase 1 gap noted in `docs/PHASE_2_BASELINE.md` §9.9 — Phase 1 had no `aud` because there was only ever one consumer. Every product **must** validate `aud` on every request, not just signature and expiry — this is what prevents a token issued for Healthcare from being replayed against Gym.

## 4. Subject

`sub` = the global Identity's id (`docs/IDENTITY_DOMAIN_MODEL.md` §2.1) — stable for the person/system across every Tenant/Organization/Product they touch. Never the Membership id, never a tenant-scoped user id.

## 5. Tenant/organization context claims

Included:

```json
{
  "tenant_id": "…",
  "organization_id": "… | null"
}
```

`tenant_id` is always present (a Membership is always inside exactly one Tenant — see domain model §4, Q11). `organization_id` reflects the Session's current active-organization selection and can be `null` (no organization actively selected / acting tenant-wide, for the rare platform-wide administrator case). See `docs/ORGANIZATION_CONTEXT.md` for how this claim gets set and changed.

Not included: `organization_unit_id`. Organization Unit scoping is not yet used by any authorization check (Phase 1 deferred its API entirely), so putting it in the token now would be speculative. Add it only when an OU-scoped permission check actually needs it — extending a JWT claim set is a non-breaking, additive change.

## 6. Authorization claims — the deliberately restrained decision

**Decision: the access token carries `roles` (role codes, org-scoped, typically 1-5 entries) but not the fully expanded `permissions` list.**

Rationale (this is the "do not put excessive authorization data into tokens" instruction from the brief, worked through explicitly):

- **Size**: a user with several roles across core + multiple products could accumulate dozens of permission codes. Every one of those bytes rides on every single API call, forever, for the life of the token.
- **Revocation/consistency**: permissions are the fastest-changing authorization artifact (an admin edits a role's permission bundle far more often than they change what roles exist). If permissions are baked into a 15-minute access token, a permission *removal* can stay live and exploitable for up to 15 minutes after an admin revokes it. Roles change far less often, and role *assignment* changes already have a bounded staleness window products can reason about.
- **Consistency across products**: if Product A caches an expanded permission list from a token and Product B does the same from a different token issued a few minutes apart, the two products can legitimately disagree about the user's permissions at the same instant. Keeping expansion server-side (or in a short-TTL local cache refreshed from one source) avoids this.

**What actually ships in the token:**

```json
{
  "roles": ["TENANT_ADMIN", "travel:booking_agent"],
  "scopes": ["identity:profile", "travel:api"]
}
```

- `roles` — role codes granted in the *active* organization context (plus tenant-wide roles), for products that want a coarse, cheap check without a network call (e.g. "does this user hold any admin-ish role at all, show the admin nav").
- `scopes` — coarse OAuth-style capability grants (per-Application, agreed at registration/consent time — "this application may call the travel API at all"), not per-action permissions.

**Where fine-grained permission checks actually happen:** a product that needs to know "can this specific user create a booking right now" calls the Identity Platform's authorization-check endpoint (`POST /v1/authorize` — see `docs/API_BOUNDARY.md`) or maintains its own short-TTL (seconds-to-low-minutes) cache of that same resolved permission set, refreshed on-demand or via a webhook/event when a role or grant changes (`ROLE_ASSIGNED`/`PERMISSION_CHANGED` audit events, see `docs/SECURITY_ARCHITECTURE.md`, are the trigger). This keeps token size bounded and puts the actual "is this still true right now" check as close to the moment of use as each product needs.

## 7. Signing and rotation

Asymmetric (RS256/EdDSA), never HS256, once more than one relying party exists — a symmetric secret shared with every product is a shared credential across trust boundaries, exactly what Phase 1's isolation principles reject at the database/network level and must equally reject at the token level. Products validate signatures against the Identity Platform's published JWKS endpoint, cached locally with normal key-rotation overlap (old key kept valid until every token signed with it has expired). Full key-management detail in `docs/SECURITY_ARCHITECTURE.md`.

**Status as of Phase 2D** (`docs/adr/ADR-017-jwt-signing-key-management.md`, refined by the Phase 2D Architecture Gate review): the actual Phase 1–2C runtime still signs with HS256 via a single shared `JWT_ACCESS_SECRET` (`src/modules/jwt/jwt.module.ts`), a deliberate, self-documented interim state, not an accidental deviation from this section — **and, on gate review, this HS256 token is never migrated at all**. This section's "asymmetric, never HS256" principle is reaffirmed but scoped, precisely: it governs the *new* OAuth/OIDC-issued token type only (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md`), since that is the token type actually handed to independent, external verifiers — the existing proprietary token remains HS256 permanently, verified only inside the Identity Platform's own process boundary, which was never the risk this principle exists to close. RS256 + JWKS is additive new infrastructure (`docs/KEY_MANAGEMENT_ARCHITECTURE.md`) — not a cutover of anything existing. **Now implemented (Phase 2D.1, `docs/PHASE_2D1.md`)**: `ExternalTokenService`/`SigningKeyService`/`GET /.well-known/jwks.json` (`src/modules/oauth/`). No `/authorize`/`/token`/OIDC endpoint issues this token type yet — 2D.1 built only the signing/verification/publication foundation.

**Now issued for real (Phase 2D.4, `docs/PHASE_2D4.md`)**: `POST /oauth/token` (`grant_type=client_credentials`) is the first endpoint that actually calls `ExternalTokenService.sign()` — a service access token (`sub = ServiceAccount.id`), independently verified in that phase's own e2e suite via a real, live `GET /.well-known/jwks.json` fetch + `crypto.createPublicKey` + `jwt.verify()` (never merely decoded). The human access token / ID token shapes remain entirely unbuilt — no `/authorize` endpoint exists yet.

## 8. Refresh token

Opaque (not a JWT — no reason to expose structure client-side), hash-only persisted (unchanged from Phase 1), rotated on every use, chained via `replacedById`/`replaces` for reuse-breach detection (`docs/AUTHENTICATION_ARCHITECTURE.md` §"Refresh lifecycle"). Never carries `aud`/`tenant_id`/authorization claims itself — it is purely a continuation credential for its Session; all context is re-resolved fresh from the Session/Membership at each refresh, which is also what makes organization-switching and permission-staleness bounded by the *access* token TTL rather than the refresh token's much longer one.
