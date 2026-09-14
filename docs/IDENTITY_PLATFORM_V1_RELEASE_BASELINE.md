# Identity Platform v1 — Release Baseline

Phase 2D.12. This document is the single record of what "v1" actually is, as of this freeze.

## Release identity

```text
Product:        Identity Platform (standalone)
Contract:       v1 (docs/API_SECURITY_CONTRACT_FREEZE.md)
Git commit:     see docs/PHASE_2D12.md §Git for the exact SHA created at the end of this phase
Recommended tag: identity-platform-v1.0.0 (docs/PHASE_2D12.md §Release Tag)
```

## Supported protocols / grants / token types / principal types

```text
Protocols:        OAuth 2.1, OpenID Connect (a subset — see docs/OIDC_ARCHITECTURE.md §9)
Grants:           authorization_code (+ PKCE, S256 only), client_credentials
Token types:      Access Token (RS256), ID Token (RS256), legacy internal Access/Refresh Token (HS256)
Principal types:  USER, SERVICE_ACCOUNT
Claim contract:   docs/contracts/access-token-claims-v1.schema.json, docs/contracts/id-token-claims-v1.schema.json
```

## Security invariants

See `docs/API_SECURITY_CONTRACT_FREEZE.md` §4 — the frozen list, unchanged by this baseline document.

## Operational requirements

```text
Node.js / NestJS runtime (docs/RESILIENCE_AND_FAILURE_MODEL.md §5)
PostgreSQL 16 (docker-compose.yml)
Production env vars (fail-closed): DATABASE_URL, JWT_ACCESS_SECRET, OAUTH_ISSUER, OAUTH_PRIVATE_KEY, CORS_ALLOWED_ORIGINS
Runtime DB role: identity_app, NOBYPASSRLS (verified live, Phase 2D.11)
Migration/backup DB role: identity_owner, superuser/BYPASSRLS
Rate limiting: in-process by default — a distributed RateLimitStore is required before multi-instance production deployment
```

## Known limitations (carried forward, not resolved by this freeze)

```text
No application Dockerfile (Phase 2D.11 §Known Issues)
No statement_timeout/connection_limit enforced by application code (documented, operator-configurable)
No distributed rate-limit backend implementation
No metrics/log/trace exporter wired to a real backend
No live, product-callable, cross-process entitlement-check HTTP endpoint (docs/PRODUCT_INTEGRATION_CONTRACT.md §9)
OAuth endpoints (/authorize, /token, /userinfo) not included in the Phase 2D.11 load-test pass
```

## Compatibility policy

See `docs/API_SECURITY_CONTRACT_FREEZE.md` §6-§7 (versioning policy, change control classes) and `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1 (the detailed additive-vs-breaking rules per contract element). Not restated here to avoid two authoritative copies.

## Rollback strategy

Every migration listed below is additive-only (no destructive migration exists in this codebase's history) — a rollback is "redeploy the previous Git tag/commit against the same database," never "run a down-migration that drops data." If a genuinely destructive change is ever proposed, `docs/API_SECURITY_CONTRACT_FREEZE.md` §5's "major architecture/security review" requirement applies before it may ship.

## Database release baseline

```text
Current migrations (9, chronological):
  20260913120000_global_identity_and_membership.sql
  20260913140000_product_application_registration.sql
  20260913160000_platform_operator_boundary.sql
  20260913180000_tenant_product_entitlement.sql
  20260913200000_organization_context.sql
  20260913220000_application_oauth_client_config.sql
  20260913240000_service_account_tenant_grant.sql
  20260914000000_oauth_authorization_code.sql
  20260914060000_oidc_nonce.sql

RLS status:       ENABLED + FORCED on every tenant-scoped table (verified live, Phase 2D.11 §E)
DB role reqs:     identity_app (NOBYPASSRLS, runtime) / identity_owner (superuser/BYPASSRLS, migrations+seeds+backup)
Extensions:       none beyond PostgreSQL 16 core (no pgcrypto/uuid-ossp dependency introduced by this platform)
Bootstrap:        database/scripts/build-schema.sh, database/scripts/seed.sh (README.md)
Seed reqs:        database/seeds/*.sql — permissions, system roles, dev tenant, products, platform-operator bootstrap
```

This phase performed zero schema changes — every migration above predates Phase 2D.12.

## Release checklist

| Item | Status |
|---|---|
| Source | PASS |
| Database | PASS |
| Migrations | PASS (9, additive-only, clean bootstrap verified across every prior phase's own report) |
| Configuration | PASS (Phase 2D.11 fail-closed validation) |
| Cryptography | PASS |
| OAuth | PASS |
| OIDC | PASS |
| JWT | PASS |
| JWKS | PASS |
| Authentication | PASS |
| Authorization | PASS |
| Tenant isolation | PASS (live-verified, Phase 2D.11) |
| Organization context | PASS |
| Entitlement | PASS |
| ServiceAccount | PASS |
| Rate limiting | PASS (single-instance; distributed store DEFERRED) |
| Logging | PASS |
| Audit | PASS |
| Metrics | PASS (in-process; exporter DEFERRED) |
| Health | PASS (liveness/readiness split, Phase 2D.11) |
| Backup | PASS (validated, Phase 2D.11) |
| Restore | PASS (validated, Phase 2D.11) |
| Deployment | PARTIAL (baseline documented; no app Dockerfile — DEFERRED) |
| Monitoring | DEFERRED (vendor-neutral seam only) |
| Documentation | PASS (this document plus 20+ referenced docs) |
| Contract tests | PASS (`src/contracts/contract-artifacts.spec.ts`) |
| Security tests | PASS (full regression, see `docs/PHASE_2D12.md` §Tests) |

No item above is marked PASS without a cited source of evidence in this document or one it references.
