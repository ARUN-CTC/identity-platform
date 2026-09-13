/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Authorization
 * transaction lifecycle) — deletes every `oauth_authorization_code` row
 * whose `expiresAt` has already passed, across EVERY tenant. A genuine
 * cross-tenant maintenance operation — deliberately a standalone script,
 * not a background-worker framework introduced into the running
 * application (the brief's own explicit instruction) — invoked by an
 * external scheduler (cron, a platform's own scheduled-job runner, etc.)
 * on whatever cadence an operator chooses; this codebase does not itself
 * decide or enforce that cadence.
 *
 * Usage:
 *   npx ts-node database/scripts/cleanup-expired-authorization-codes.ts
 *
 * REQUIRES an elevated/RLS-exempt DATABASE_URL (e.g. the same
 * `identity_owner` role `database/scripts/build-schema.sh`/`migrate.sh`
 * already require) — `oauth_authorization_code` has `apply_tenant_rls`
 * (Phase 2D.7), and this script's whole point is a CROSS-TENANT delete, so
 * it cannot run as the `identity_app` runtime role (which would see zero
 * rows: `tenant_id = current_tenant_id()` never matches an unset session
 * GUC). Never grant `identity_app` itself `BYPASSRLS` merely to support
 * this one script — that would defeat RLS for every OTHER table too.
 *
 * Never deletes an unexpired row (`expires_at > now()`), consumed or not —
 * the identical safety invariant `AuthorizationCodesRepository.deleteExpiredForTenant()`
 * already enforces for the per-tenant, RLS-scoped case this script's
 * cross-tenant version generalizes. Idempotent: running it twice in a row
 * with nothing newly expired deletes zero rows the second time, exactly as
 * expected of a safe, repeatable maintenance operation.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    console.log(`Deleted ${result.count} expired oauth_authorization_code row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Cleanup failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
