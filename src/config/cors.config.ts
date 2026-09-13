/**
 * Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) — extracted
 * from `src/main.ts`'s own `bootstrap()` so the origin-list parsing has a
 * unit-testable surface independent of a running Nest application (no
 * existing e2e test fixture replicates `main.ts`'s own CORS setup — every
 * fixture builds its app directly via `TestingModule`, never `bootstrap()`
 * — the same class of gap Phase 2D.9 found for `ValidationPipe`).
 *
 * Returns `undefined` (meaning: reflect any origin, `@nestjs/cors`'s own
 * default) when `raw` is unset/empty — the local-development default;
 * `validateProductionConfig` (Phase 2D.9/2D.11) refuses to boot in
 * production without `CORS_ALLOWED_ORIGINS` explicitly set, so this
 * permissive branch is never reachable in a production deployment.
 */
export function parseCorsAllowedOrigins(raw: string | undefined): string[] | undefined {
  const origins = raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins && origins.length > 0 ? origins : undefined;
}
