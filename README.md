# Identity Platform

A modular, product-agnostic Identity & Access Management (IAM) platform: tenants, organizations, users, RBAC (roles/permissions), sessions, authentication, and security audit — built to eventually back TravelOS, Healthcare, Gym, and other future SaaS products.

**Phase 1 status**: an isolated baseline extracted from TravelOS's reusable IAM core. See `docs/PHASE_1.md` for the full report and `docs/PROJECT_ISOLATION.md` for why and how this project is fully independent of TravelOS.

## Prerequisites

- Node.js 20+
- Docker (for the local Postgres instance)

## Local setup

```bash
npm install
cp .env.example .env
# Edit .env: set a real JWT_ACCESS_SECRET (openssl rand -base64 48)

docker compose up -d                 # starts identity-platform-db on host port 5434

# Build the schema and load seed data — requires an elevated DB role (identity_owner),
# NOT the .env DATABASE_URL (which is the least-privilege identity_app runtime role):
DATABASE_URL="postgresql://identity_owner:changeme@localhost:5434/identity_platform_db" npm run db:build-schema
DATABASE_URL="postgresql://identity_owner:changeme@localhost:5434/identity_platform_db" npm run db:seed

npm run db:generate                  # generates the Prisma client
npm run start:dev                    # starts the API on http://localhost:4000
```

Verify it's up:

```bash
curl http://localhost:4000/health
```

## Bootstrap credentials (local dev only)

Seeded by `database/seeds/003_bootstrap_dev_tenant.sql` — change or remove before any non-local use:

- Tenant code: `DEV`
- Email: `admin@example.com`
- Password: `ChangeMe123!`

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantCode":"DEV","email":"admin@example.com","password":"ChangeMe123!"}'
```

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Start the API in watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (requires the API's dependencies, e.g. the database, to be reachable) |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:build-schema` | Apply `database/shared` + `database/ddl` (extensions, functions, tables) — requires an elevated DB role |
| `npm run db:seed` | Load `database/seeds` — requires an elevated DB role |
| `npm run db:reset` | Drop and rebuild the schema, then reseed — **destructive**, asks for confirmation |
| `npm run db:migrate` | Apply any files under `database/migrations` not yet recorded in `schema_migrations` |

## API docs

Swagger UI is served at `/api/docs` once the app is running.

## Project isolation

This project has its own repository, database, environment configuration, and Docker stack — zero runtime dependency on TravelOS. See `docs/PROJECT_ISOLATION.md`.
