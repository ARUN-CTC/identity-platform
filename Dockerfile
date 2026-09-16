# Production image for the Identity Platform backend (NestJS + Prisma).
#
# Base image choice: node:22-slim (Debian, glibc) — NOT node:22-alpine.
# Two production dependencies are native/binary: `argon2` (password
# hashing) and `@prisma/client` (its query-engine binary is generated for
# whatever platform/libc ran `prisma generate` — this schema sets no
# `binaryTargets`, so it defaults to "native"). Alpine's musl libc would
# require adding an explicit musl binaryTarget to database/prisma/schema
# and revalidating argon2's prebuilt-binary compatibility — a schema change
# this Dockerfile has no mandate to make. Every stage below uses the SAME
# base image family so a binary generated in one stage is guaranteed
# compatible with every other; `prisma generate` still re-runs in the
# runtime stage against its own freshly-installed production node_modules,
# so no compiled binary is ever copied across a stage boundary.
#
# Multi-stage: `deps`/`build` bring in devDependencies and TypeScript
# source only to produce dist/; the final `runtime` stage installs
# production dependencies ONLY, contains no source, no devDependencies, no
# .git history, and never receives a .env file (see .dockerignore) —
# configuration comes exclusively from the container's own environment at
# `docker run`/orchestrator time, matching validateProductionConfig()'s own
# fail-closed expectations in src/config/production-config.validation.ts.

ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------------------
# Stage 1: install full (incl. dev) dependencies for building.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: generate the Prisma client and compile TypeScript -> dist/.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json nest-cli.json ./
COPY database/prisma ./database/prisma
COPY src ./src
RUN npx prisma generate --schema=database/prisma/schema \
    && npm run build

# ---------------------------------------------------------------------------
# Stage 3: production runtime — only what's needed to run dist/main.js.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    TZ=UTC \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

# Production dependencies only — a completely fresh install, never copied
# from the build stage, so this image never contains a devDependency.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    # curl only for the HEALTHCHECK below; removed from the same layer so
    # it never lands in the final image size, and apt lists are cleaned up
    # in the same RUN to avoid leaving a stale package index in a layer.
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Regenerated here (not copied from `build`) — guarantees the query-engine
# binary matches THIS stage's own install of @prisma/client exactly, with
# zero cross-stage binary-compatibility assumption.
COPY database/prisma ./database/prisma
RUN npx prisma generate --schema=database/prisma/schema

COPY --from=build /app/dist ./dist

# Non-root: a dedicated, unprivileged user/group rather than the image's
# existing (and often UID-1000-colliding) `node` user, with the app
# directory explicitly owned by it — nothing in this image is writable by
# any other principal.
RUN groupadd --gid 1001 identity \
    && useradd --uid 1001 --gid identity --home-dir /app --shell /usr/sbin/nologin identity \
    && chown -R identity:identity /app
USER identity

EXPOSE 4000

# Liveness-shaped check (never touches the database — see
# src/modules/health/controllers/health.controller.ts's own GET /health/live)
# so a slow/degraded Postgres cannot itself trigger a container restart
# loop; only "the process is alive and serving HTTP" gates this healthcheck.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -f http://127.0.0.1:4000/health/live || exit 1

# Exec form (no shell) so Node receives SIGTERM directly from the
# container runtime — see src/main.ts's enableShutdownHooks()/onModuleDestroy
# for what happens when it does.
CMD ["node", "dist/main.js"]
