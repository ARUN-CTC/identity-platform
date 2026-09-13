# Identity External API Contract

Phase 2D.10 — the WIRE-LEVEL contract a product integrates against: HTTP endpoints, JWT claim shapes, JWKS, and error codes. Language-agnostic on purpose — a real product resource server may be written in any stack; nothing here requires Node/NestJS/Prisma. See `docs/PRODUCT_INTEGRATION_CONTRACT.md` for the ownership/pipeline contract and `docs/SDK_BOUNDARY.md` for what a future SDK would wrap around this.

## 1. Versioning (brief §19)

Every route in this platform is served under `/api/v1/*` (`app.setGlobalPrefix('api/v1', {exclude: [...]})`, `src/main.ts`), **except** the two paths that MUST resolve at their OIDC/JWKS-spec-mandated fixed locations regardless of API version: `GET /.well-known/openid-configuration` and `GET /.well-known/jwks.json`. This exclusion is not an oversight — a generic OIDC/JWKS client library will never look for either at a versioned path, so moving them would break every conformant client, not just this platform's own.

```text
/api/v1/oauth/authorize
/api/v1/oauth/token
/api/v1/oauth/userinfo
/.well-known/openid-configuration   (exempt — spec-fixed)
/.well-known/jwks.json              (exempt — spec-fixed)
```

**Compatibility rules** (brief §19 — "do not create a versioning scheme that requires simultaneous upgrades of every product"):

| Change | Classification |
|---|---|
| New optional JWT claim | Non-breaking — products must ignore unrecognized claims |
| New optional discovery-document field | Non-breaking — OIDC clients must ignore unrecognized members |
| New OAuth scope | Non-breaking — a product that doesn't request it is unaffected |
| New `IdentityBearerErrorCode`/`IdentityTokenEndpointErrorCode` value | Non-breaking — products should treat an unrecognized code as a generic denial, never crash |
| New principal type (beyond `USER`/`SERVICE_ACCOUNT`) | **Breaking** — any product doing exhaustive type-switching must be updated first |
| Removing/renaming an existing claim, error code, or endpoint | **Breaking** — requires a new API version (`/api/v2/...`), never a silent change to `v1` |
| Changing what `principal.tenantId ` means, or removing the tenant-header-override prohibition | **Breaking** — a security-contract change, never shipped without a major version and a dedicated migration document |

No product is ever required to upgrade merely because another product integrated a new optional field.

## 2. Discovery (brief §18)

`GET /.well-known/openid-configuration` (`DiscoveryController`, Phase 2D.8, unchanged) advertises only implemented capabilities:

```json
{
  "issuer": "<OAUTH_ISSUER>",
  "authorization_endpoint": "<issuer>/api/v1/oauth/authorize",
  "token_endpoint": "<issuer>/api/v1/oauth/token",
  "userinfo_endpoint": "<issuer>/api/v1/oauth/userinfo",
  "jwks_uri": "<issuer>/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub", "name", "given_name", "family_name", "preferred_username", "email", "email_verified"],
  "grant_types_supported": ["authorization_code", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "none"],
  "code_challenge_methods_supported": ["S256"]
}
```

No `registration_endpoint` (no Dynamic Client Registration), no `revocation_endpoint`/`introspection_endpoint`, no `implicit`/`hybrid` response type, no `plain` PKCE method — consistent with §5 below (do not advertise capability this platform does not implement).

`GET /.well-known/jwks.json` (`JwksController`, Phase 2D.1) — the public key set, `kid`-indexed, RS256 only.

## 3. Access Token claim contract (brief §13)

```text
iss              this platform's configured issuer (OAUTH_ISSUER) — verified, never merely copied
sub              ServiceAccount.id (SERVICE_ACCOUNT) or security_user.id (USER) — never Application.id
aud              the ONE resource-API audience this token was issued for — never an array, never a wildcard (§5)
client_id         the registered Application's clientId
tenant_id         server-validated at issuance — authoritative (docs/PRODUCT_INTEGRATION_CONTRACT.md §4)
scope             space-delimited, absent means no scopes
iat / exp / nbf
jti               correlation only
token_use         'access_token' (distinguishes from an ID Token's 'id_token' — Phase 2D.8)
principal_type    'USER' | 'SERVICE_ACCOUNT' — the ONLY authoritative discriminator (never inferred from sub's shape)
organization_id?   USER only
```

## 4. ID Token claim contract (brief §13)

```text
iss / sub / aud (= the requesting client's own client_id, never a resource-API audience) / iat / exp
nonce            echoed verbatim from the /authorize request
token_use        'id_token'
```

plus scope-gated OIDC claims (`name`/`given_name`/`family_name`/`preferred_username` for `profile`; `email`/`email_verified` for `email`) — never a tenant/organization/scope/IAM claim (`docs/OIDC_ARCHITECTURE.md` §2-3, unchanged).

**Never mixed**: an ID Token is consumed exactly once, by the client that requested it, for client-side identity display — never presented to a resource server. An Access Token is presented to a resource server on every API call — never validated as an ID Token. `token_use` plus the resource-server validator's explicit ID-Token rejection make this a structural, not merely documented, guarantee.

## 5. Audience contract (brief §8)

- Every product/resource server has its OWN, explicit audience string, registered on the Application that will request tokens for it (`Application.audiences`, Phase 2D.2).
- `aud` is always a single string, never an array, at every token-issuance call site in this codebase (`ExternalTokenService.sign()`, `IdTokenService.sign()`) — verified by direct source review, Phase 2D.10.
- Wildcard/implicit-all audience values are rejected AT REQUEST TIME, before any policy check — `client-credentials.service.ts`'s `FORBIDDEN_AUDIENCE_VALUES`/`.includes('*')` check (Phase 2D.4, unchanged) — `aud=*`, `aud=all-products`, and similar are all `400 invalid_target`, never issued.
- A resource server declares its own required audience via `@ExpectedAudience(...)` (Phase 2D.5) — mandatory, never defaulted; a route using `ExternalBearerAuthGuard` without it is a configuration error, not a silent accept-anything fallback.
- No multi-audience token model exists in this platform — unsupported, not merely unused.

## 6. Error contract (brief §15)

`src/contracts/identity-error.contract.ts` is the canonical, tested re-export of both error-code unions below.

**Resource-server (bearer-token) errors** — `IdentityBearerErrorCode`:

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_request` | 400 | Malformed request shape (e.g. ambiguous multiple Authorization headers) |
| `invalid_token` | 401 | Token missing, malformed, expired, wrong signature/issuer/audience, or an ID Token presented as a bearer token — **never further distinguished externally** |
| `insufficient_scope` | 403 | Token valid, but lacks a required OAuth scope |
| `forbidden` | 403 | Token valid and scoped, but denied at the product-authorization layer (missing entitlement, no policy registered, product policy denied, provider error) |

**Token-endpoint errors** — `IdentityTokenEndpointErrorCode` (RFC 6749 §5.2, unchanged): `invalid_request` (400), `invalid_client` (401), `unauthorized_client` (400), `unsupported_grant_type` (400), `invalid_scope` (400), `invalid_target` (400), `access_denied` (403), `invalid_grant` (400), `unsupported_response_type` (400 — `/authorize` only).

**401 vs. 403, always**: 401 means "re-authenticate" (the credential itself is not currently valid); 403 means "this identity is known and valid, but not allowed to do this." A product must branch on this distinction, never treat both as one generic "denied."

**No enumeration, ever**: a `tenant_mismatch`, `product_not_entitled`, `principal_not_authorized`, "client does not exist," and "service account does not exist" all collapse to the SAME generic `forbidden`/`invalid_token` externally — the specific reason is available only in this platform's own internal audit log (`docs/OAUTH_OPERATIONAL_HARDENING.md` §Security observability), never in the HTTP response. This is unchanged from every prior phase (Phase 2D.4 §Non-enumeration, Phase 2D.6 §24) — Phase 2D.10 introduces no new enumeration surface.

## 7. UserInfo contract

See `docs/PRODUCT_INTEGRATION_CONTRACT.md` §8 and `docs/OIDC_ARCHITECTURE.md` §6 — restated here only for completeness: `GET /api/v1/oauth/userinfo`, access token only, `identity-platform-userinfo` audience, `openid` scope, subject from the validated principal exclusively.

## 8. What this contract explicitly does NOT cover

Everything named in `docs/PHASE_2D10.md` §Deferred Scope — no Dynamic Client Registration, Device Authorization Grant, Token Exchange, Impersonation, pairwise subjects, ACR/AMR, or refresh-token redesign is part of this contract, this phase or any prior one.
