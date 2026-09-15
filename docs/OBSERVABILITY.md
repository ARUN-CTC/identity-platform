# Observability

Future boundary — no new tooling is stood up in Phase 2; this defines what Phase 2 implementation work should emit into, so instrumentation added later doesn't need re-plumbing.

## 1. Signal types

| Signal | Source | Notes |
|---|---|---|
| Metrics | Request counts/latency/error rates per route, token issuance/refresh/revocation counts, login success/failure ratio, active session count | Standard RED metrics (rate/errors/duration) plus IAM-specific counters |
| Logs | Structured (JSON) application logs | Never include password, token, or `client_secret` values — see redaction rule below |
| Traces | Per-request span, propagated `trace_id` | Especially valuable across the Identity Platform ↔ Product boundary once a product calls `/v1/authorize` or the token-introspection path synchronously in its own request path |
| Audit events | `SecurityEvent`/`AuditEvent` table (`SECURITY_ARCHITECTURE.md` §6) | Durable, queryable, tenant-scoped — distinct from logs (logs are operational/ephemeral; audit events are a compliance record with their own retention policy) |
| Security events | Subset of the above flagged high-severity (reuse detection, repeated auth failures, privilege-escalation attempts blocked) | Should be able to page a human, not just be queryable after the fact |
| Health checks | `/health` (already exists, Phase 1) | Liveness: process is up. Readiness: database reachable + migrations applied — split the two so a rolling deploy doesn't route traffic to an instance whose DB pool isn't warm yet, but a transient DB blip doesn't get the whole process killed by an orchestrator's liveness probe |

## 2. Correlation

Every request carries (and every log/trace/audit line includes, where applicable):

```text
request_id       — generated per HTTP request, always present
trace_id         — propagated if the caller sends one (W3C traceparent), generated otherwise
user_id          — the acting Identity's sub, once authenticated
tenant_id
organization_id
application_id   — which registered Application/client_id made the call
```

This is the same correlation set already implied by `RequestContextService` (Phase 1) plus the two new IAM-specific fields (`application_id`, and `organization_id` promoted from "exists in schema, unused" to "always populated once `ORGANIZATION_CONTEXT.md` ships"). A product receiving a `request_id`/`trace_id` from the Identity Platform in an error response should be able to hand it to platform support and have it be immediately findable — this is a contract, not just a nice-to-have, once multiple products depend on one shared platform.

## 3. Redaction rule

No log line, trace span attribute, or metric label may ever contain: a raw password, a raw access/refresh/reset/invitation token, a `client_secret`, or a full Authorization header. Enforced at the logging-interceptor level (a single chokepoint, per Phase 1's existing `ResponseInterceptor`/`AllExceptionsFilter` pattern) rather than trusted to every call site — the same principle already applied to audit event `metadata` in `SECURITY_ARCHITECTURE.md` §6.

## 4. Nothing implemented in Phase 2

No metrics backend, tracing backend, or log aggregation platform is chosen or deployed here — that is an infrastructure decision independent of the identity domain model and is left to whichever deployment environment hosts this platform. This document only fixes the *shape* of what gets emitted so that choice doesn't retroactively change application code.
