# Project Isolation

This document explains why the Identity Platform is a fully separate project from TravelOS, and how that separation is enforced and verified.

## Why a separate project

TravelOS's own Authentication/User Management/Organization/Authorization/Sessions/Audit code turned out to be almost entirely product-agnostic — nothing in the actual identity/RBAC/multi-tenancy machinery is travel-industry-specific. The travel-specific parts (bookings, itineraries, suppliers, customers, etc.) are a separate concern layered on top of that identity core in TravelOS. Extracting the reusable core into its own project makes it possible to build Healthcare, Gym, and other future SaaS products on the same IAM foundation without dragging in TravelOS's product domains, and without every future product being coupled to TravelOS's own release cycle, database, or codebase.

## TravelOS isolation strategy

TravelOS is treated as **read-only source material**, never as a dependency:

- No import, package reference, git submodule, or file-path reference from this repository into the TravelOS repository exists anywhere in source, config, or dependency manifests. Verified by a full-repo grep for `travelos`/`TravelOS` — every hit is a documentation comment recording where a piece of code was extracted from (see `docs/IDENTITY_SOURCE_INVENTORY.md`, `docs/TRAVELOS_COUPLING.md`).
- Nothing was copied by reference (symlink, npm `file:` dependency, git submodule) — every extracted file was read from TravelOS and re-written as a new, independent file in this repository. (One accidental exception surfaced and was corrected during Phase 1: see "Incidents" below.)
- No TravelOS file was modified, deleted, or renamed at any point during this work.

## Database isolation

- This project owns a single, independent PostgreSQL database, `identity_platform_db`, running in its own Docker container (`identity-platform-db`) on host port **5434** — deliberately not 5432/5433, where a local Postgres instance or a TravelOS stack may already be listening.
- No table, schema, role, or extension in `identity_platform_db` is shared with `travelos_db`. The schema was built from this repository's own `database/shared` and `database/ddl` SQL files, independently of TravelOS's `packages/database`.
- `.env.example` documents `DATABASE_URL` pointed at `identity_platform_db` only, and includes an explicit, permanently-empty `TRAVELOS_DATABASE_URL=` line as a tripwire: no code in this repository reads that variable, so if it is ever set and something starts reading it, that is a violation of this document, not an intended integration path.
- A dedicated, least-privilege `identity_app` Postgres role (owning nothing, `NOBYPASSRLS`) is the only role the running application ever connects as — schema/seed/migration operations run as an elevated `identity_owner` role instead. This mirrors, but is entirely separate from, TravelOS's own `travelos_app`/owner-role split.

## Repository isolation

- Independent git repository at `E:\wrkspc\identity-platform`, initialized with its own `git init` and its own commit history — not a branch, fork, or worktree of the TravelOS repository. `git rev-parse --show-toplevel` from each repository confirms two entirely separate toplevels.
- Independent `package.json`, `tsconfig.json`, `nest-cli.json`, `.gitignore` — none extend or reference a TravelOS config file.

## Environment isolation

- Distinct `.env`/`.env.example` with its own variable names and no shared secrets with TravelOS.
- Distinct JWT signing secret, distinct database credentials, distinct mail configuration.
- Distinct Docker Compose project name (`identity-platform`), distinct container names (`identity-platform-db`), distinct named volume (`identity-platform-db-data`), distinct host port (5434) — chosen specifically so this stack and a TravelOS stack can run simultaneously on the same machine with zero collision. Verified live: this project's containers and TravelOS's own `travelos-postgres-1`/`travelos-redis-1`/`travelos-frontend-1` containers ran side by side throughout Phase 1's build/verification without incident.

## Security boundaries

- Independent JWT signing secret (`JWT_ACCESS_SECRET`) — a token issued by this platform is not valid against TravelOS and vice versa.
- Independent password hashes, sessions, refresh tokens, and audit trail — no shared identity store of any kind.
- Independent RBAC catalog: role/permission codes were deliberately re-scoped for a generic platform (e.g. TravelOS's `AGENT` role, a travel-industry-specific name, was replaced with the generic `MEMBER`; the permission catalog was trimmed from TravelOS's ~150 codes to 9 identity-core codes). See `docs/TRAVELOS_COUPLING.md` for the full list and rationale.

## Future integration strategy (not built in Phase 1)

When a product (TravelOS or otherwise) eventually integrates with this platform instead of its own bespoke identity code, the integration point is expected to be a network API boundary (this platform's REST API, secured by its own JWTs), never a shared database, a shared codebase import, or a shared deployment. No such integration exists yet, and Phase 1 deliberately does not build one — see `docs/PHASE_1.md`'s Phase 2 recommendations.

## Isolation test — what to run yourself

The single most important acceptance test for this project is described in the original Phase 1 request:

> We must be able to delete, stop, or completely disconnect TravelOS and the Identity Platform must still build and run independently.

Everything short of actually stopping TravelOS's own running containers was verified during Phase 1 (see `docs/PHASE_1.md`'s "Isolation verification" section for the full checklist and results). Stopping TravelOS's containers as a live test was attempted and was blocked by this session's own tooling safety controls (a workload-interference guard), not by any technical dependency — so this specific step is left for you to run by hand:

```bash
# From a terminal, with the Identity Platform already running (see README.md):
docker stop travelos-postgres-1 travelos-redis-1 travelos-frontend-1
curl http://localhost:4000/health   # expect {"status":"ok","database":"up",...} unaffected
docker start travelos-postgres-1 travelos-redis-1 travelos-frontend-1
```

## Incidents

**npm workspace contamination (caught and fixed during Phase 1).** While running `npm install` for this project, an `npm --prefix` invocation issued from a shell whose actual working directory was still the TravelOS repository root (which declares npm `workspaces`) caused npm to add a stray dependency to this project's own `package.json`: `"travelos": "file:../travelOS/TravelPlatform/travelos"`, resolving to a symlink at `node_modules/travelos` pointing at the entire TravelOS repository. This was caught immediately (it surfaced as an unexpected diff in `package.json`), removed, and the root cause (running `npm install` with the wrong effective working directory) was fixed by always running `cd <this-repo> && npm install` as a single command from then on. No TravelOS file was touched by this incident — the only artifact affected was this project's own `package.json`/`package-lock.json`/`node_modules`, all restored to a clean state and reverified (`grep -ri travelos` across the whole repository shows only documentation comments, listed in `docs/PHASE_1.md`).
