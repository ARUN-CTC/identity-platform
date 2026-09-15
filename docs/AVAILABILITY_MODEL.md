# Failure & Availability Model

What happens when the Identity Platform is unavailable, per operation class. This is what makes the platform's blast radius a deliberate design choice rather than a discovery made during an actual incident.

## 1. Operations that keep working with no live Identity Platform connectivity

- **Access-token validation.** A product validates a JWT locally against its cached JWKS (`TOKEN_ARCHITECTURE.md` §7) — no network call to the Identity Platform is required per request. This is the single most important availability property in the whole design: **product functionality for already-authenticated users continues to work even if the Identity Platform goes down**, up to the access token's natural expiry.
- **Coarse authorization checks** (roles/scopes from the token) — same reasoning, no live call needed.
- **Anything a product has already cached** from an on-demand or webhook-fed local copy (§ `DATA_OWNERSHIP.md` "read-only cache" pattern) — display names, role assignments last synced, etc.

## 2. Operations that require live Identity Platform connectivity

- **New login.** Cannot succeed — the Identity Platform is the only holder of credentials.
- **Token refresh.** Cannot succeed once the current access token expires — this is the actual, bounded blast radius of an outage: users get logged out (forced to wait for refresh, then re-login) roughly `access_token_ttl` after the outage begins, not immediately. This is why the access-token TTL (`TOKEN_ARCHITECTURE.md`) is chosen as a deliberate trade-off between authorization staleness (§6 of that document) and outage resilience — a shorter TTL tightens staleness but shortens the outage grace window; this is recorded explicitly so a future TTL change is made with both consequences in view, not just one.
- **Fine-grained authorization checks** via `POST /v1/authorize` for any product that doesn't maintain its own cache — those products degrade harder during an outage than ones that do maintain a short-TTL local cache (`TOKEN_ARCHITECTURE.md` §6); this is a real incentive for products to build that cache, not just a performance optimization.
- **Any administrative operation** (create organization, assign role, register a permission, issue a service token) — these are inherently writes against the Identity Platform's own data; there is no meaningful offline mode for them.
- **Service-to-service calls** (client-credentials token issuance) — same as login: cannot succeed without connectivity, though an already-issued service access token remains valid and locally verifiable exactly like a user access token.

## 3. Recommended mitigations (documented, not built in Phase 2)

- Multi-instance/multi-AZ deployment of the Identity Platform itself, since — per §2 — new logins and refreshes have no offline fallback and therefore the Identity Platform's own uptime target should be the highest in the whole system (every product inherits it as a floor).
- JWKS caching with a generous local TTL and background refresh-ahead (so a product doesn't experience a hard failure the instant its cache expires mid-outage).
- Encourage (not mandate) products to implement the local permission cache described in `TOKEN_ARCHITECTURE.md` §6, specifically framed to product teams as an availability benefit, not just a latency one.
- A status page / health-check contract (`OBSERVABILITY.md`) so products can distinguish "Identity Platform is down" from "my own network path to it is down" when deciding how to degrade their own UX (e.g. show a banner vs. silently retry).

## 4. What this document deliberately does not promise

No claim of "the Identity Platform must have zero downtime" — that is an infrastructure/ops commitment outside Phase 2's architecture scope. This document instead makes sure the *consequence* of downtime is well-understood, bounded, and asymmetric in the right direction (existing sessions survive; new logins and admin writes don't) rather than an accident of implementation.
