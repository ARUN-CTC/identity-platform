/**
 * Phase 2B.1 — production-safe bootstrap for the FIRST Platform Operator
 * (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Bootstrap"). Deliberately not a
 * SQL seed file: seed files are dev/test-only, hand-documented placeholder
 * credentials (database/seeds/005_bootstrap_platform_operator.sql) — this
 * script is the real-environment equivalent, taking credentials from the
 * environment, never hardcoding or committing them.
 *
 * Usage:
 *   PLATFORM_OPERATOR_EMAIL=ops@example.com PLATFORM_OPERATOR_PASSWORD='...' \
 *     npx ts-node database/scripts/bootstrap-platform-operator.ts
 *
 * Idempotent: if an ACTIVE Platform Operator already exists anywhere, this
 * exits cleanly with a message and creates nothing — it does not create a
 * second one, and it does not error (Step 20: "define what happens if
 * bootstrap is executed twice").
 *
 * Runs against DATABASE_URL exactly as the application itself does — no
 * elevated/owner role is required, because platform_operator (and every
 * table it touches) has no RLS (database/ddl/006_platform_operator.sql).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

async function main(): Promise<void> {
  const email = process.env.PLATFORM_OPERATOR_EMAIL;
  const password = process.env.PLATFORM_OPERATOR_PASSWORD;

  if (!email || !password) {
    console.error('PLATFORM_OPERATOR_EMAIL and PLATFORM_OPERATOR_PASSWORD must both be set. Nothing was created.');
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error('PLATFORM_OPERATOR_PASSWORD is too short (minimum 12 characters for this highly-privileged account). Nothing was created.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existingActive = await prisma.platformOperator.findFirst({ where: { status: 'ACTIVE' } });
    if (existingActive) {
      console.log('An ACTIVE Platform Operator already exists — bootstrap is idempotent, nothing was created.');
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await prisma.securityUser.upsert({
      where: { email },
      update: {},
      create: {
        email,
        firstName: 'Platform',
        lastName: 'Operator',
        status: 'ACTIVE',
        passwordHash,
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });

    // If this email already existed as a global Identity with a DIFFERENT
    // password, the upsert's `update: {}` deliberately leaves their
    // existing password untouched — this script only ever sets a password
    // for an Identity it is itself creating.
    const existingOperator = await prisma.platformOperator.findFirst({ where: { userId: user.id } });
    if (existingOperator) {
      console.log(`'${email}' already has a (non-ACTIVE) Platform Operator record — reactivate it explicitly via the API rather than re-running bootstrap.`);
      return;
    }

    const platformPermissions = await prisma.securityPermission.findMany({ where: { platformOnly: true, deletedAt: null } });

    const operator = await prisma.$transaction(async (tx) => {
      const created = await tx.platformOperator.create({ data: { userId: user.id, status: 'ACTIVE' } });
      await tx.platformOperatorPermission.createMany({
        data: platformPermissions.map((p) => ({ operatorId: created.id, permissionId: p.id })),
      });
      await tx.securityEvent.create({
        data: {
          scope: 'PLATFORM',
          actorUserId: user.id,
          eventType: 'PLATFORM_OPERATOR_CREATED',
          resourceType: 'PlatformOperator',
          resourceId: created.id,
          metadata: { email, source: 'bootstrap-script', permissionCodes: platformPermissions.map((p) => p.permissionCode) },
        },
      });
      return created;
    });

    console.log(`Platform Operator bootstrapped for '${email}' (id: ${operator.id}), granted ${platformPermissions.length} platform permission(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
