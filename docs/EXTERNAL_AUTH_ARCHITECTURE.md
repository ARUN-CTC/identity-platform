# External Application & Service Authentication Architecture

Overview document for Phase 2D (`docs/PHASE_2D_ARCHITECTURE.md`). This document establishes the trust boundaries and principal model; `docs/OAUTH_ARCHITECTURE.md`/`docs/OIDC_ARCHITECTURE.md`/`docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md` detail each flow.

## 1. Two kinds of external consumer

Every consumer of this platform beyond its own first-party surfaces is exactly one of:

- **A human, acting through a product application** (a browser SPA, a mobile app, a server-rendered web app) — authenticates via OIDC/OAuth authorization_code+PKCE (`docs/OAUTH_ARCHITECTURE.md`), ultimately proving a `security_user`'s identity.
- **A service, acting on its own behalf** (a backend job, a webhook processor, a cron task, one product's API calling another) — authenticates via OAuth client_credentials (`docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md`), proving a `ServiceAccount`'s identity, never a human's.

These are never conflated. A service is never represented as a fake human user (no synthetic `security_user` row is ever created "on behalf of" a service) — see ADR-015, ADR-018.

## 2. Trust boundary diagram

```text
                                    IDENTITY PLATFORM
                                  (Authorization Server,
                                   OpenID Provider, Token
                                   Issuer, JWKS Provider)
                                            │
                        ┌───────────────────┴───────────────────┐
                        │                                       │
                 HUMAN IDENTITY                        APPLICATION IDENTITY
              (security_user — TRUSTED,             (Application/ServiceAccount —
               owned by this platform)                SEMI-TRUSTED, registered
                        │                              by a product, credentialed)
                        ▼                                       ▼
                PRODUCT CLIENTS                         SERVICE CLIENTS
           (SPA / mobile / web app —                 (backend job / API-to-API
            UNTRUSTED for public                      caller — semi-trusted,
            clients, semi-trusted                      holds a confidential
            for confidential clients)                  credential)
                        │                                       │
                        └───────────────────┬───────────────────┘
                                            ▼
                                     PRODUCT APIs
                              (RESOURCE SERVERS — owned and
                               operated by each product, not
                               this platform; semi-trusted to
                               validate tokens correctly)
                                            │
                                  TENANT / ORGANIZATION
                                (resolved server-side only,
                                 never from client input)
                                            │
                                     PRODUCT'S OWN RLS
                              (each product's own database
                               isolation — a pattern this
                               platform demonstrates, not a
                               shared mechanism)
```

- **Trusted**: the Identity Platform itself — the only holder of private signing key material, the only writer of `security_user`/`Membership`/`Organization`/`Tenant` rows, the sole issuer of every token.
- **Untrusted**: a public client (SPA/mobile) — holds no secret, cannot be relied on to keep anything confidential; every design decision assumes its runtime can be inspected by its own user.
- **Semi-trusted**: a confidential client (a product's own backend) and a resource server (a product's own API) — each holds real credentials or verifies real tokens, but is operated by a different team than the Identity Platform and must never be assumed to enforce this platform's own invariants correctly without independent verification (hence mandatory `aud` checks, mandatory PKCE, etc., rather than relying on client cooperation).
- **Platform Operators**: a structurally separate principal (ADR-010, unchanged) that administers trust configuration (which Applications exist, which scopes/audiences/grant types they hold, which tenants a service may act on) — never itself a Membership-holding organization member, never an impersonation mechanism (`docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md` §Platform Operator interaction).

## 3. Application/Client model (unchanged decision, extended attributes)

`Application` remains the single OAuth "client" entity (ADR-009, reaffirmed ADR-018) — no separate `Client` table. Conceptually, once OAuth is actually implemented:

```text
Product
 └── Application (== OAuth Client)
      ├── applicationType: CONFIDENTIAL | PUBLIC        (existing: clientType)
      ├── tokenEndpointAuthMethod: derived from type     (NEW, conceptual)
      ├── redirectUris: [...]                            (existing, becomes enforced)
      ├── allowedOrigins: [...]                          (existing, becomes enforced)
      ├── grantTypes: subset of {authorization_code,
      │                          refresh_token,
      │                          client_credentials}     (NEW, conceptual)
      ├── allowedScopes: [...]                           (NEW, conceptual)
      ├── audiences: [...]                               (NEW, conceptual)
      ├── status: ACTIVE | ... (existing)
      └── credentials: clientId, clientSecretHash, ...   (existing)
```

A **service principal** (`ServiceAccount`, future entity — `docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md`) *references* an Application (typically one scoped to `client_credentials` only); it is not a variant of Application's client type (ADR-018).

## 4. Public vs. confidential applications

| | Public client | Confidential client |
|---|---|---|
| Examples | SPA, mobile app, desktop app | Server-side web app, internal service, service backend |
| Secret | None — cannot keep one confidential | `client_secret`, hashed at rest (existing `clientSecretHash`) |
| PKCE | Mandatory (its only proof of code-exchange legitimacy) | Mandatory (OAuth 2.1 applies uniformly — ADR-013) |
| Grant types | `authorization_code` (+`refresh_token`) only | `authorization_code`, `client_credentials` |
| Token-endpoint auth | `none` | `client_secret_basic`/`client_secret_post` |
| Security implication | Assume the runtime is inspectable by its own end user; never trust it to keep any credential secret | May hold and protect a real secret; still never trust it more than its own operational security posture warrants |

## 5. What this document does not decide

Endpoint-by-endpoint request/response contracts (`docs/EXTERNAL_API_TRUST_BOUNDARY.md`), the token claim shape (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md`), and the full threat model (`docs/PHASE_2D_THREAT_MODEL.md`) are each their own document — this one exists to fix the principal/trust model every other Phase 2D document assumes.
