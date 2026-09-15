# Authentication Architecture

Defines who authenticates users, how, and for which caller shapes. Builds on `docs/IDENTITY_DOMAIN_MODEL.md` and `docs/PRODUCT_REGISTRATION.md`. Does not implement MFA/SSO/passkeys/SAML — those are future boundaries, marked as such below.

## 1. Caller shapes and how each authenticates

| Caller | Authenticates as | Mechanism today (Phase 2) | Future |
|---|---|---|---|
| Browser (product's own frontend) | End user | Product's frontend collects credentials, calls Identity Platform's `POST /v1/auth/login` directly (browser talks to Identity Platform, not proxied through the product backend, to avoid the product ever handling raw passwords) | + Passkeys, + SSO redirect |
| Mobile app | End user | Same login endpoint; refresh token stored in platform-appropriate secure storage (Keychain/Keystore), not a cookie | + Passkeys, biometric-gated local unlock of a stored refresh token |
| Product backend (on behalf of a user) | Validates a token the user already obtained; never itself logs the user in | Receives the access token from its own frontend/mobile client, validates signature + claims locally (JWKS-cached, see `docs/TOKEN_ARCHITECTURE.md`) | Unchanged |
| Product backend (service-to-service, no user) | Itself, as a `ServiceAccount` | OAuth2 client-credentials grant against the Identity Platform (`docs/SECURITY_ARCHITECTURE.md` §Service-to-service) | + mTLS option |
| Third-party application (not one of our own products) | End user, via delegated consent | Not built — requires the OAuth2 Authorization Code grant (`docs/adr/ADR-007-oidc-oauth-strategy.md`) | Full OAuth2/OIDC authorization-code flow |

The key architectural rule: **only the Identity Platform ever sees a password.** A product frontend calling `/v1/auth/login` directly (rather than proxying through its own backend) is the recommended pattern precisely so that no product backend needs to be trusted with credential handling, brute-force protection, or password storage — those live in exactly one place.

## 2. Conceptual login flow

```text
Browser/Mobile
     │  POST /v1/auth/login { identifier, password, client_id }
     ▼
Identity Platform
     │
     ├── Resolve Identity by identifier (global — see IDENTITY_DOMAIN_MODEL.md §2.1)
     ├── Verify credential (Argon2id)
     ├── Resolve caller's Memberships → which Organization(s)/Tenant(s) this Identity can act in
     ├── Resolve client_id → Application → Product; check TenantProductSubscription is ACTIVE
     ├── Create Session (records device/IP, active_organization_id = default/most-recent or null)
     ├── Issue access token (aud = Application, claims per TOKEN_ARCHITECTURE.md)
     ├── Issue opaque refresh token bound to the Session
     └── Record SecurityEvent(LOGIN_SUCCESS) / SecurityLoginAttempt
     ▼
Browser/Mobile ← { access_token, refresh_token, identity, organizations[] }
```

If the Identity has more than one Membership reachable through this `client_id`'s Product (i.e., more than one Tenant subscribes them to this product), the login response includes the list of eligible organizations and the client is expected to let the user pick — the access token is minted for whichever organization is selected (default: the only one, if there's just one). See `docs/ORGANIZATION_CONTEXT.md` for what happens when a user later switches.

## 3. Endpoint-level lifecycle definitions

### Login
`POST /v1/auth/login` — see flow above. Rate-limited per identifier and per IP (`docs/SECURITY_ARCHITECTURE.md`). Always writes a `SecurityLoginAttempt` row, success or failure, before returning.

### Logout
`POST /v1/auth/logout` — revokes the current Session (sets `revokedAt`/`revokedReason = "LOGOUT"`), which cascades to revoke its refresh token(s). The access token already issued remains cryptographically valid until it expires (it is short-lived by design, see `docs/TOKEN_ARCHITECTURE.md`) — logout is a session/refresh-path guarantee, not an instant access-token kill switch, unless the deployment also enforces the optional token-denylist check described there for high-sensitivity products.

### Session lifecycle
`Session` is created at login, `lastUsedAt` bumped on each refresh, and ends via: explicit logout, explicit revocation (`DELETE /v1/sessions/{id}`, self or admin), expiry (`expiresAt`, driven by `remember_me` and tenant/application token policy), or a security event (password change → all other sessions for that Identity revoked).

### Refresh lifecycle
`POST /v1/auth/refresh` — presents the opaque refresh token; the Identity Platform verifies its hash, checks it hasn't been rotated-away or revoked, mints a new access token + rotates the refresh token (issues a new one, marks the old `rotatedAt`, links via `replacedById`). Reuse of an already-rotated refresh token is treated as token theft: the entire Session's refresh-token chain is revoked and a `SecurityEvent(REFRESH_TOKEN_REUSE_DETECTED)` is recorded (this is the standard refresh-token-rotation breach-detection pattern; Phase 1's schema already supports the chain, this is a Phase 2 behavioral contract for it — see `docs/TOKEN_ARCHITECTURE.md`).

### Token revocation
Explicit (logout, admin-initiated `DELETE /v1/sessions/{id}`, password change, detected reuse) always revokes at the **refresh token / Session** level. Access-token revocation before natural expiry is not guaranteed by default (stateless JWT) — see `docs/TOKEN_ARCHITECTURE.md` §Revocation for the deliberate trade-off and its opt-in denylist escape hatch.

### Password lifecycle
Unchanged mechanism from Phase 1: forgot-password issues a hash-only-stored, self-identifying reset token (tenant-in-cleartext-plus-hashed-secret pattern); reset invalidates all other sessions for that Identity. Password policy (length/complexity/rotation/breach-list checking) is defined in `docs/SECURITY_ARCHITECTURE.md`.

## 4. Future MFA boundary

Not built in Phase 2. The boundary is reserved at the `Credential` entity (an Identity can have 0/1 password credentials + 0..N MFA factor credentials, each independently typed: TOTP, WebAuthn/passkey, SMS-backup) and at the Session model (a Session can be flagged `mfa_verified: bool` plus `amr` claim on the token — Authentication Methods Reference, an OIDC-standard claim name, adopted early so this doesn't need renaming later). No factor-enrollment or verification endpoint exists yet.

## 5. Future SSO boundary

Not built in Phase 2. Reserved at the `Application`/`Product` level: an enterprise Tenant could eventually configure an external Identity Provider (SAML or OIDC) *per Tenant*, with the Identity Platform acting as the Service Provider/Relying Party, translating an external assertion into a normal Session + Membership resolution — the rest of the platform (tokens, RBAC, sessions) is unaffected because SSO only replaces the *credential verification* step, not anything downstream. See `docs/adr/ADR-007-oidc-oauth-strategy.md`.
