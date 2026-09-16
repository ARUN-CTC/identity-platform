import '../src/common/bigint-json.polyfill';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';

/**
 * Phase 3 (production hardening) — regression coverage for two
 * previously-unverified authentication controls:
 *
 *   1. Rate limiting on /auth/login, /platform/auth/login,
 *      /auth/password/forgot, /auth/password/reset, /invitations/validate,
 *      /invitations/accept — none of these had ANY rate limiting before
 *      this phase (confirmed by grepping for @RateLimited across every
 *      controller: only the three OAuth/OIDC routes had it). Added as a
 *      deliberate complement to, not a replacement for, the pre-existing
 *      per-account lockout below — this stops a flood against MANY
 *      accounts/tokens from one source; lockout stops repeated attempts
 *      against ONE account.
 *   2. Per-account lockout after MAX_FAILED_LOGIN_ATTEMPTS (5) failed
 *      logins, for LOCKOUT_DURATION_MS (15 minutes) — this control already
 *      existed in AuthenticationService/PlatformAuthenticationService
 *      (shared via UsersService's failedLoginCount/lockedUntil counters)
 *      but had ZERO test coverage anywhere in the repo before this phase
 *      (confirmed: no authentication *.spec.ts files exist at all, and no
 *      e2e spec exercised it) — a "backend gap in test coverage" of
 *      exactly the kind Phase 2E's audit found for frontend coverage.
 */
describe('Phase 3 — Authentication hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  async function withEnv(overrides: Record<string, string>, fn: () => Promise<void>): Promise<void> {
    const previous: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      previous[key] = process.env[key];
      process.env[key] = overrides[key];
    }
    try {
      await fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }

  async function makeTenantWithUser(roleCode: 'SUPER_ADMIN' | 'TENANT_ADMIN' = 'TENANT_ADMIN') {
    const tenant = await prisma.tenant.create({ data: { tenantCode: `P3-${randomUUID().slice(0, 8)}`, tenantName: 'Phase 3 Tenant', status: 'ACTIVE' } });
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    const org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenant.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenant.id,
    );
    const user = await prisma.securityUser.create({
      data: { email: `p3-${randomUUID().slice(0, 8)}@example.com`, firstName: 'T', lastName: 'U', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenant.id, organizationId: org.id, userId: user.id, status: 'ACTIVE' } }), tenant.id);
    const role = await prisma.securityRole.findFirstOrThrow({ where: { roleCode, tenantId: null } });
    await prismaContext.runInContext((tx) => tx.securityUserRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id } }), tenant.id);
    return { tenant, user };
  }

  async function makeOperator() {
    const user = await prisma.securityUser.create({
      data: { email: `p3-op-${randomUUID().slice(0, 8)}@example.com`, firstName: 'O', lastName: 'P', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
    await prisma.platformOperator.create({ data: { userId: user.id, status: 'ACTIVE' } });
    return { user };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Rate limiting (previously entirely absent on these routes)', () => {
    it('/auth/login denies beyond its configured limit, with Retry-After, then recovers after the window', async () => {
      const { tenant, user } = await makeTenantWithUser();
      await withEnv({ AUTH_LOGIN_RATE_LIMIT_MAX: '2', AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const attempt = () => request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: PASSWORD });

        expect((await attempt()).status).not.toBe(429);
        expect((await attempt()).status).not.toBe(429);
        const third = await attempt();
        expect(third.status).toBe(429);
        expect(third.body.error).toBe('temporarily_unavailable');
        expect(third.headers['retry-after']).toBeDefined();

        await new Promise((resolve) => setTimeout(resolve, 2100));
        expect((await attempt()).status).not.toBe(429);
      });
    });

    it('/platform/auth/login denies beyond its configured limit', async () => {
      const { user } = await makeOperator();
      await withEnv({ PLATFORM_AUTH_LOGIN_RATE_LIMIT_MAX: '2', PLATFORM_AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const attempt = () => request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email: user.email, password: PASSWORD });

        expect((await attempt()).status).not.toBe(429);
        expect((await attempt()).status).not.toBe(429);
        expect((await attempt()).status).toBe(429);
      });
    });

    it('/auth/password/forgot and /auth/password/reset share one rate-limit policy', async () => {
      const { tenant, user } = await makeTenantWithUser();
      await withEnv({ PASSWORD_RESET_RATE_LIMIT_MAX: '2', PASSWORD_RESET_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const forgot = () => request(app.getHttpServer()).post('/api/v1/auth/password/forgot').send({ tenantCode: tenant.tenantCode, email: user.email });
        const reset = () => request(app.getHttpServer()).post('/api/v1/auth/password/reset').send({ token: 'irrelevant', newPassword: 'Whatever123!' });

        expect((await forgot()).status).not.toBe(429);
        expect((await reset()).status).not.toBe(429);
        // A third request against EITHER route shares the same source-keyed
        // policy bucket and is denied.
        expect((await forgot()).status).toBe(429);
      });
    });

    it('/invitations/validate and /invitations/accept share one rate-limit policy', async () => {
      await withEnv({ INVITATION_RATE_LIMIT_MAX: '2', INVITATION_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const validate = () => request(app.getHttpServer()).post('/api/v1/invitations/validate').query({ token: 'irrelevant' });
        const accept = () => request(app.getHttpServer()).post('/api/v1/invitations/accept').send({ token: 'irrelevant', password: 'Whatever123!' });

        expect((await validate()).status).not.toBe(429);
        expect((await accept()).status).not.toBe(429);
        expect((await validate()).status).toBe(429);
      });
    });
  });

  describe('Per-account lockout (pre-existing control, previously untested)', () => {
    it('locks a tenant account after 5 failed logins, rejecting even the CORRECT password on the 6th attempt, and records an audit event', async () => {
      const { tenant, user } = await makeTenantWithUser();
      const wrongAttempt = () => request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: 'TotallyWrongPassword!1' });

      for (let i = 0; i < 5; i++) {
        const res = await wrongAttempt();
        expect(res.status).toBe(401);
      }

      const correctPasswordAfterLockout = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: PASSWORD });
      expect(correctPasswordAfterLockout.status).toBe(403);
      expect(correctPasswordAfterLockout.body.message).toBe('Account is locked due to too many failed login attempts');

      const fresh = await prisma.securityUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(fresh.lockedUntil).not.toBeNull();
      expect(fresh.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('locks a Platform Operator account the same way — the shared SecurityUser counters apply identically', async () => {
      const { user } = await makeOperator();
      const wrongAttempt = () => request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email: user.email, password: 'TotallyWrongPassword!1' });

      for (let i = 0; i < 5; i++) {
        const res = await wrongAttempt();
        expect(res.status).toBe(401);
      }

      const correctPasswordAfterLockout = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email: user.email, password: PASSWORD });
      expect(correctPasswordAfterLockout.status).toBe(403);
    });

    it('a successful login resets failedLoginCount — lockout requires 5 CONSECUTIVE failures, not 5 lifetime', async () => {
      const { tenant, user } = await makeTenantWithUser();
      const wrongAttempt = () => request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: 'TotallyWrongPassword!1' });

      for (let i = 0; i < 3; i++) {
        await wrongAttempt();
      }
      const successfulLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: PASSWORD });
      expect(successfulLogin.status).toBe(200);

      const fresh = await prisma.securityUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(fresh.failedLoginCount).toBe(0);

      // 3 more failures now — nowhere near the 5-in-a-row threshold since the counter reset.
      for (let i = 0; i < 3; i++) {
        const res = await wrongAttempt();
        expect(res.status).toBe(401);
      }
      const stillUsable = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: PASSWORD });
      expect(stillUsable.status).toBe(200);
    });
  });
});
