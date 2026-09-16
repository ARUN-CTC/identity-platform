# TLS / Reverse Proxy Runbook

Phase 3.1 — this application never terminates TLS itself (confirmed: no
certificate/key loading code exists anywhere in `src/`, and
`docs/RESILIENCE_AND_FAILURE_MODEL.md` §5 already states this explicitly).
No reverse-proxy technology (Nginx, Kubernetes Ingress, an AWS ALB, IIS,
etc.) is referenced or assumed anywhere in this repository, so this runbook
is deliberately **architecture-neutral**: it states the REQUIRED behavior
any TLS-terminating layer in front of this backend must provide, not a
config file for one specific product. Pick the equivalent setting in
whichever proxy/load balancer your deployment actually uses.

## Required behavior

| Requirement | Why |
|---|---|
| **HTTPS only** — the backend itself only ever speaks plain HTTP (`app.listen(PORT)`, no TLS options passed) | TLS is exclusively the proxy's job in this architecture; the backend must never be reachable directly from the internet on its own port |
| **HTTP → HTTPS redirect** at the proxy | Bearer tokens, refresh tokens, and login credentials must never be sent in plaintext, even to a redirect target |
| **TLS 1.2 minimum, TLS 1.3 preferred; no TLS 1.0/1.1, no weak cipher suites** | Standard current best practice; this app has no opinion of its own, but MUST NOT be exposed by a proxy that allows a weaker configuration |
| **Valid certificate management** (ACME/Let's Encrypt, a managed cert service, or an internal CA) with automated renewal | Manual renewal is an outage waiting to happen; not this application's own responsibility to manage |
| **HSTS** (`Strict-Transport-Security`) — this app's own `helmet` integration (Phase 3.1, `src/config/security-headers.config.ts`) already sets it on every response; it only takes effect once the browser has received it over a real HTTPS connection, so the proxy terminating TLS is what makes it meaningful | Prevents protocol downgrade on repeat visits |
| **Forwarded headers**: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` set by the proxy | This app derives `req.ip` (used for rate-limit keying and login-attempt audit records — see `src/common/rate-limit/rate-limit-key.util.ts`'s own doc comment on why it's hashed, never logged raw) from Express's own `trust proxy` resolution of these headers. **A production deployment behind any reverse proxy MUST set Express's `trust proxy` setting** (e.g. `app.set('trust proxy', 1)` for exactly one hop, or the proxy's real IP range) — otherwise every request appears to originate from the proxy's own IP, collapsing every source-IP-scoped rate limit (Phase 3 — `AUTH_LOGIN_POLICY_NAME` etc.) and login-attempt audit record into one shared bucket for all real clients. **Not yet configured in this codebase** (`main.ts` never calls `app.set('trust proxy', ...)`) — documented here as a required production deployment step, not silently assumed. |
| **WebSocket behavior**: N/A | This backend exposes no WebSocket endpoint anywhere (grep-confirmed: no `@WebSocketGateway`/`ws`/`socket.io` in `src/`) — nothing for a proxy to special-case |
| **Request size limits** | Already enforced at the application layer via `class-validator` `@MaxLength` decorators on every externally-supplied string field (confirmed, Phase 2D.9 — `docs/OAUTH_OPERATIONAL_HARDENING.md` §2); a proxy-level body-size cap (e.g. 1MB) is still recommended as defense-in-depth against a request that never reaches those decorators (a malformed/oversized body Express itself has to buffer first) |
| **Timeout policy** | Not configured at the application layer (no explicit Express/Node server timeout override in `main.ts`) — a production proxy should set its own upstream read/connect timeouts (a reasonable starting point: 30s for ordinary API calls; `/oauth/token`/`/oauth/authorize` and any other endpoint under this app's own rate limiting complete well within that) |
| **Upstream health checks** | Point the proxy's own upstream health check at `GET /health/ready` (fails closed — 503 — the instant the database is unreachable) or `GET /health/live` if the intent is "is the process itself alive" rather than "can it serve real traffic" — see `docs/PRODUCTION_READINESS.md` §R for the liveness/readiness split's own rationale |
| **Rate limiting placement** | This application's own rate limiting (Phase 2D.9 OAuth routes; Phase 3 login/password-reset/invitation routes) is IP-hashed and must remain the authoritative control — do not rely on a proxy-level rate limit as a substitute, since the proxy has no knowledge of per-account lockout state or the specific policy each route needs. A proxy-level rate limit is still reasonable as a coarser, earlier line of defense (e.g. a blanket per-IP connection-rate cap) |
| **Access logging** | This app's own structured `Logger` output covers application-level events; proxy-level access logs (method, path, status, latency, client IP) are a separate, complementary layer this repository has no opinion about the format of |
| **Client IP handling** | See "Forwarded headers" above — this is the single most important item on this list for this app specifically, since it directly affects the correctness of Phase 3's own new rate-limit/lockout controls in any deployment sitting behind a proxy |

## What this repository does NOT assume

No cloud provider, ingress controller, or specific proxy product is
referenced anywhere in source or documentation. Do not interpret this
runbook's structure as an implicit recommendation for any one of them —
translate each row above into whatever your actual deployment target uses.

## Action item surfaced by this review

`app.set('trust proxy', ...)` is not called anywhere in `main.ts`. This is
**not a security bypass today** (this development/CI environment has no
reverse proxy in front of it, so `req.ip` is already the real, direct
connection IP) but it IS a real, concrete step required before this
application is deployed behind any reverse proxy/load balancer — without
it, Phase 3's own new per-IP rate limiting and lockout-adjacent login-
attempt audit records would silently collapse every real client into one
shared identity (the proxy's own IP). Track this as a deployment
prerequisite, not a code defect to fix speculatively without knowing the
real proxy's IP range/hop count.
