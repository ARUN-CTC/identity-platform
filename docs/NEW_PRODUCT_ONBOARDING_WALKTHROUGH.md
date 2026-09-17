# New Product Onboarding — Worked Walkthrough

A concrete, end-to-end walkthrough of onboarding a brand-new product onto this Identity Platform, from zero to a resource server validating a real access token. Every request/response, error, and claim below is **real output captured live against a running instance** of this platform (local dev database) — not a hypothetical. Where the platform rejected a request, that rejection is shown verbatim, because the correct/incorrect shape of a request is exactly what a real integrator needs to see.

This document is a **runbook and worked example**, not a redesign of anything. For the conceptual data model, see `docs/PRODUCT_REGISTRATION.md`; for the platform/product ownership split, see `docs/PRODUCT_INTEGRATION_CONTRACT.md`; for the multi-product isolation guarantee this walkthrough proves in practice, see `docs/EXTERNAL_API_TRUST_BOUNDARY.md`. Where those documents use older terminology (`TenantProductSubscription`), this document uses the current, as-built name: `TenantProductEntitlement` (ADR-011).

## The mental model

```text
Product (catalog entry, Platform-Operator-owned)
   └── Application  (an OAuth/OIDC client: web app, mobile app, backend service)
              │
              │  authorization_code + PKCE (human user)
              │  or client_credentials (machine, via a ServiceAccount)
              ▼
        real access token, scoped to exactly ONE audience

Tenant ── TenantProductEntitlement ──→ Product   (tenant is allowed to use it — a billing/access fact)
```

Everything below is one worked example: a fictional product, **"Fleet Manager"** (`slug: fleet-manager`), onboarded from nothing.

## Actors and their tools

| Actor | Where they work | Auth boundary |
|---|---|---|
| Platform Operator | Platform Console (`/platform-console`) | Separate login, separate JWT (`platform_operator_permission`), never a tenant session |
| Tenant Admin | Tenant app (`/`) | Ordinary tenant JWT, `TENANT_ADMIN`/`SUPER_ADMIN` role |
| End user | The product's own web/mobile app | Ordinary tenant JWT, any role |
| Product's own backend | Wherever the product deploys it | No login at all — validates bearer tokens via this platform's public JWKS |

A Platform Operator does steps 1–3. A logged-in end user (via the product's own app) does step 4. The product's own backend does step 5. **No step requires a code change to this Identity Platform.**

---

## Step 1 — Register the Product

**UI**: Platform Console → Products → **Register product**.
**API**: `POST /products` (requires platform permission `PRODUCT_MANAGE`; a tenant-scoped `SUPER_ADMIN` token is rejected here on purpose — verified by `tests/phase2b1-platform-operator.e2e-spec.ts`).

Request body:

```json
{
  "name": "Fleet Manager",
  "slug": "fleet-manager",
  "description": "Vehicle fleet tracking and maintenance product."
}
```

The `slug` is permanent — it doubles as the OAuth scope-namespace prefix (e.g. `fleet-manager.vehicles.read`) and can never be changed after creation. Response (`201`):

```json
{
  "id": "0d9d2e7a-c226-4296-9f16-c6160d27969b",
  "name": "Fleet Manager",
  "slug": "fleet-manager",
  "status": "ACTIVE",
  ...
}
```

The UI drops you straight onto the product's detail page, with an empty "Applications (OAuth clients)" section underneath — a Product on its own grants no one access to anything; it is purely a catalog entry.

## Step 2 — Register an Application (OAuth client)

A Product can own multiple Applications — a web frontend, a mobile app, a backend service — each a separate credential holder with its own blast radius if compromised.

**UI**: on the product's page → **Register application**.
**API**: `POST /products/:productId/applications` (same `PRODUCT_MANAGE` permission).

### Choosing CONFIDENTIAL vs PUBLIC

| | CONFIDENTIAL | PUBLIC |
|---|---|---|
| Gets a `client_secret` | Yes (shown once) | No (`clientSecret: null`) |
| Typical use | Server-rendered app, backend service | SPA, mobile app — anything that can't keep a secret |
| Security relies on | Secret + PKCE (if `authorization_code`) | PKCE alone |

This walkthrough uses **PUBLIC**, so the token exchange never needs a secret:

```json
{
  "name": "Fleet Manager Mobile",
  "clientType": "PUBLIC",
  "grantTypes": ["authorization_code"],
  "redirectUris": ["http://localhost:5174/callback"],
  "allowedScopes": ["openid", "profile", "email", "fleet-manager.vehicles.read"]
}
```

Response includes the client identity, and (for a CONFIDENTIAL app only) the plaintext secret:

```json
{
  "id": "fb9212bc-c33b-4bc7-9c42-84fe31bb08b9",
  "clientId": "cli_OVQs7rt-FXIm1tihMFP5v91u",
  "clientType": "PUBLIC",
  "tokenEndpointAuthMethod": "none",
  "audiences": [],
  "clientSecret": null
}
```

**One-time secret reveal (CONFIDENTIAL clients only)**: the UI shows the plaintext secret exactly once, in a modal ("This client secret will not be shown again. Copy it now and store it securely."), then never again anywhere in the product. The backend only ever persists `client_secret_hash`. **There is no recovery** if it's lost — the only remedy is issuing a new secret. Plan credential handoff to the product's own engineering team accordingly (a password manager / secrets vault entry created at this exact moment, not "I'll copy it later").

### Registering the resource-API audience

Every Application must explicitly enumerate which resource API(s) it may ever request a token for — there is **no wildcard/implicit-all audience** (`ApplicationAudiencePolicy`, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §5). This was empty above; add it via `PATCH /applications/:id`:

```bash
curl -X PATCH https://<host>/api/v1/applications/fb9212bc-c33b-4bc7-9c42-84fe31bb08b9 \
  -H "Authorization: Bearer <platform-operator token>" \
  -H "Content-Type: application/json" \
  -d '{"audiences": ["fleet-manager-api"]}'
```

`fleet-manager-api` here is simply a string Fleet Manager's own backend and this platform agree on — it is never interpreted or validated against anything else. Pick something stable and unique per resource API you stand up (a second Fleet Manager microservice would get its own audience value).

## Step 3 — Grant a Tenant an Entitlement

Registering the product/application grants **no one** access. A tenant must be explicitly entitled.

**UI**: Platform Console → Tenant Registry → *(tenant)* → Product Entitlements → select product → **Grant**.
**API**: `POST /platform/tenants/:tenantId/product-entitlements`

```json
{ "productId": "0d9d2e7a-c226-4296-9f16-c6160d27969b" }
```

Response:

```json
{
  "id": "828ef597-550c-4856-b6a8-d91d23b472ec",
  "tenantId": "3fc113e6-f04e-4eaa-9c44-e452f8aa1bf6",
  "productId": "0d9d2e7a-c226-4296-9f16-c6160d27969b",
  "status": "ACTIVE"
}
```

Confirmed from the tenant's own side, `GET /product-entitlements` (as a tenant user):

```json
[{ "productId": "0d9d2e7a-...", "productName": "Fleet Manager", "productSlug": "fleet-manager", "status": "ACTIVE", "eligible": true }]
```

**Known UX gap, found live**: the "Select a product to grant…" control is a plain dropdown with no search/filter. On a database with many products (a long-lived dev/test environment routinely accumulates thousands from e2e runs), the product you want may not be visible without an API-level workaround. Not a defect in the entitlement model itself — a real production catalog will never approach test-database scale — but worth a search/autocomplete upgrade if this screen is used against a database with more than a page's worth of products.

Lifecycle from here: **Suspend** / **Revoke** are available on the same screen (`PATCH .../product-entitlements/:productId`), and a suspended-then-restored entitlement uses **Reactivate** (`POST .../product-entitlements/:productId/reactivate`) rather than re-granting — see `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md`.

---

## Step 4 — The end-user journey: Authorization Code + PKCE

This is what Fleet Manager's own frontend does when a user clicks "Sign in." No separate login page exists for this — the user must **already hold a valid platform session** (an ordinary tenant JWT, obtained via `POST /auth/login` the normal way). `GET /oauth/authorize` reuses that session; it never renders or accepts a username/password itself.

### 4.1 — Generate a PKCE pair (client-side, before redirecting)

```js
const verifier = base64url(crypto.randomBytes(32));           // kept secret, in the app
const challenge = base64url(sha256(verifier));                 // sent openly
```

### 4.2 — Redirect the browser to `/oauth/authorize`

First attempt — deliberately incomplete, to show what the platform actually enforces:

```
GET /oauth/authorize?response_type=code&client_id=cli_OVQs7rt-FXIm1tihMFP5v91u
  &redirect_uri=http://localhost:5174/callback
  &scope=openid%20profile%20email%20fleet-manager.vehicles.read
  &state=xyz123&code_challenge=<challenge>&code_challenge_method=S256
Authorization: Bearer <user's session token>
```

Response — a real, spec-correct rejection:

```
302 Found
Location: http://localhost:5174/callback?error=invalid_request
  &error_description=nonce+is+required+when+scope+includes+openid&state=xyz123
```

**Why**: requesting the `openid` scope means an ID token will be issued; OIDC requires a `nonce` on that request to prevent ID-token replay. Add `&nonce=<random>` and retry:

```
302 Found
Location: http://localhost:5174/callback?error=invalid_request
  &error_description=audience+is+required&state=xyz123
```

**Why**: this platform never issues an "audience-less" token — every token is minted for exactly one resource API, matching whatever the Application's own `audiences` allow-list contains (Step 2). Add `&audience=fleet-manager-api` and retry:

```
302 Found
Location: http://localhost:5174/callback?code=M2ZjMTEz...S1GE9U0giVlcCiBPT5cb&state=xyz123
```

Success. This is the real redirect the user's browser follows back to Fleet Manager's own `/callback` route, carrying a short-lived, single-use authorization code — never a token, never a secret, in the URL (brief §27 / `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`).

### 4.3 — Exchange the code for tokens (server-side, in Fleet Manager's backend)

```bash
curl -X POST https://<host>/api/v1/oauth/token \
  -d grant_type=authorization_code \
  -d code=M2ZjMTEz...S1GE9U0giVlcCiBPT5cb \
  -d redirect_uri=http://localhost:5174/callback \
  -d client_id=cli_OVQs7rt-FXIm1tihMFP5v91u \
  -d code_verifier=<the original verifier — no client_secret, this is a PUBLIC client>
```

Response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "openid profile email fleet-manager.vehicles.read",
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

### 4.4 — What Fleet Manager's backend actually receives

Decoded access-token claims (RS256, verifiable via this platform's own `GET /.well-known/jwks.json`):

```json
{
  "sub": "b8bc480e-59d6-43c1-80f6-4c749c5ed7dc",
  "client_id": "cli_OVQs7rt-FXIm1tihMFP5v91u",
  "tenant_id": "3fc113e6-f04e-4eaa-9c44-e452f8aa1bf6",
  "scope": "openid profile email fleet-manager.vehicles.read",
  "principal_type": "USER",
  "token_use": "access_token",
  "aud": "fleet-manager-api",
  "iss": "identity-platform",
  "exp": 1789626519
}
```

`aud` is the load-bearing claim for isolation — see Step 5.

---

## Step 5 — The resource-server side: validating the token

Fleet Manager's own backend is a **resource server**: it never talks to this platform's database, never has its own login, and validates bearer tokens purely via JWKS + claim checks. This platform ships a generic, reusable demo controller (`src/modules/resource-server/controllers/resource-server-demo.controller.ts`) built from exactly the primitives (`ExternalBearerAuthGuard`, `@ExpectedAudience`, `requireScope`, `assertRequestedTenantMatches`) any real product's backend uses to build its own equivalent — see `docs/RESOURCE_SERVER_ARCHITECTURE.md`.

### 5.1 — Negative proof: multi-product isolation

The Fleet Manager token above (`aud: fleet-manager-api`) presented to a *different* resource server (one expecting `aud: resource-server-demo-api`):

```bash
curl https://<host>/api/v1/resource-server/demo/whoami -H "Authorization: Bearer <fleet-manager-token>"
```
```json
{"error":"invalid_token","error_description":"The access token is invalid, expired, or not recognized"}
```
`401`. Note the error is deliberately generic — it never discloses *why* (no "audience mismatch" detail), so a token stolen from one product's integration is useless against another's, and probing doesn't even confirm the reason it failed.

### 5.2 — Positive proof: a token that IS meant for that resource server

Added a second audience to the same client (`"audiences": ["fleet-manager-api", "resource-server-demo-api"]`), re-ran Step 4 requesting `audience=resource-server-demo-api` instead, then:

| Call | Result |
|---|---|
| `GET /resource-server/demo/whoami` | `200` — full validated principal (subject, tenant, client, scopes, `jti`) |
| `GET /resource-server/demo/scoped` (requires `openid` scope) | `200 {"ok":true,"scopes":[...]}`|
| `GET /resource-server/demo/tenant-bound` with `X-Tenant-Id: <correct tenant>` | `200` |
| Same call with a **wrong** `X-Tenant-Id` | `403 "The requested tenant does not match the authenticated token"` |

The last row matters: a caller cannot override which tenant it's acting as by sending a different header — the signed token, not caller-supplied metadata, is authoritative. A real product backend implements the identical pattern: extract the bearer token, verify it (cached JWKS key, `docs/OAUTH_OPERATIONAL_HARDENING.md` §8), check `aud` matches its own resource identifier, check required scopes, and treat `tenant_id`/`sub` from the token — never from a header or body field — as ground truth.

---

## What just happened, end to end

| Entity | Created by | Table |
|---|---|---|
| 1 `Product` row | Platform Operator | `product` |
| 1–2 `Application` rows | Platform Operator | `application` |
| 1 `TenantProductEntitlement` row | Platform Operator | `tenant_product_entitlement` |
| 0 rows | — | Nothing about `User`, `Tenant`, `Organization`, `Role`, `Session`, or `Token` changed shape |

This is the acceptance test for the platform's product-agnosticism claim (`docs/MULTI_PRODUCT_INTEGRATION.md` §5): onboarding "Product X" is catalog rows plus OAuth client registration, never an Identity Platform code change, migration, or deployment.

## Pitfalls a real integrator will hit (all reproduced above, verbatim)

1. **`nonce is required when scope includes openid`** — always include `nonce` whenever `openid` is in the requested scope.
2. **`audience is required`** — every authorize request must name a resource audience, and it must already be in the Application's own `audiences` allow-list (`PATCH /applications/:id` before first use).
3. **The client secret is shown exactly once.** Capture it into a secrets vault at creation time, not "afterward" — there is no admin screen that will ever show it again.
4. **Cross-audience tokens fail closed with a generic error.** If your own integration gets an unexplained `401 invalid_token`, check the token's `aud` claim against what your resource server expects before assuming JWKS/network trouble.
5. **The tenant-entitlement grant dropdown has no search** on a database with many products — use the API directly (`POST /platform/tenants/:tenantId/product-entitlements`) if the UI list is impractically long.

## See also

- `docs/PRODUCT_REGISTRATION.md` — the conceptual data model (`Product`/`Application`/entitlement/`ServiceAccount`)
- `docs/PRODUCT_INTEGRATION_CONTRACT.md` — the stable ownership boundary between this platform and any product
- `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md` — entitlement state transitions (suspend/revoke/reactivate) in full
- `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md` — the authorize/token protocol detail this walkthrough exercised
- `docs/RESOURCE_SERVER_ARCHITECTURE.md` — how to build a product's own resource-server-side validation
- `docs/EXTERNAL_API_TRUST_BOUNDARY.md` — the multi-product/`aud`-per-product isolation guarantee Step 5 proved live
- `docs/MULTI_PRODUCT_INTEGRATION.md` — the original TravelOS/Healthcare/Gym worked example (predates the `TenantProductEntitlement` rename; conceptually still accurate)
