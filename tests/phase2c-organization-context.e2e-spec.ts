import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';

/**
 * Phase 2C acceptance tests — Organization Context & Context Switching
 * (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md, ADR-012). Runs against the
 * real identity_platform_db, same pattern as every prior phase's suite.
 * Every fixture uses a random suffix so repeated runs never collide with
 * each other or with the DEV bootstrap seed data.
 */
describe('Phase 2C — Organization Context & Context Switching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenantA: { id: string; tenantCode: string; tenantName: string };
  let tenantB: { id: string; tenantCode: string; tenantName: string };
  let orgA1: { id: string };
  let orgA2: { id: string };
  let orgB1: { id: string };
  let orgTypeId: string;
  let tenantAdminRoleId: string;
  let memberRoleId: string;

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
  }

  async function addMembership(tenantId: string, organizationId: string, userId: string, status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED' = 'ACTIVE') {
    return prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId, userId, status } }), tenantId);
  }

  async function grantRole(tenantId: string, userId: string, roleId: string, organizationId?: string) {
    return prismaContext.runInContext(
      (tx) => tx.securityUserRole.create({ data: { tenantId, userId, roleId, organizationId } }),
      tenantId,
    );
  }

  async function loginOk(tenantCode: string, email: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode, email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    return res.body;
  }

  /** Decodes a JWT's payload WITHOUT verifying the signature — test-only convenience for asserting on claims. */
  function decodeClaims(jwt: string): Record<string, unknown> {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  }

  async function switchContext(accessToken: string, organizationId: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/v1/auth/context/switch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ organizationId });
  }

  async function clearContext(accessToken: string): Promise<request.Response> {
    return request(app.getHttpServer()).post('/api/v1/auth/context/clear').set('Authorization', `Bearer ${accessToken}`);
  }

  async function me(accessToken: string): Promise<request.Response> {
    return request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);

    tenantA = await prisma.tenant.create({ data: { tenantCode: `P2C-A-${suffix}`, tenantName: 'Phase 2C Tenant A', status: 'ACTIVE' } });
    tenantB = await prisma.tenant.create({ data: { tenantCode: `P2C-B-${suffix}`, tenantName: 'Phase 2C Tenant B', status: 'ACTIVE' } });

    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    orgTypeId = orgType.id;

    orgA1 = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-A1', organizationName: 'Org A1' } }),
      tenantA.id,
    );
    orgA2 = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-A2', organizationName: 'Org A2' } }),
      tenantA.id,
    );
    orgB1 = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantB.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-B1', organizationName: 'Org B1' } }),
      tenantB.id,
    );

    const tenantAdminRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'TENANT_ADMIN', tenantId: null } });
    const memberRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'MEMBER', tenantId: null } });
    tenantAdminRoleId = tenantAdminRole.id;
    memberRoleId = memberRole.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Login starts tenant-wide — no organization context assumed', () => {
    it('a freshly logged-in session carries no organizationId claim, and /auth/me reflects tenant-wide context', async () => {
      const user = await createGlobalUser(`fresh-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      expect(decodeClaims(tokens.accessToken).organizationId).toBeUndefined();

      const meRes = await me(tokens.accessToken);
      expect(meRes.body.organizationContext).toEqual({ organizationId: null, organizationName: null });
    });
  });

  describe('Same-tenant context switch', () => {
    it('switching to an organization the user has an ACTIVE membership in succeeds, mutates the SAME session, and applies org-scoped role grants', async () => {
      const user = await createGlobalUser(`sametenant-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await grantRole(tenantA.id, user.id, memberRoleId, orgA1.id); // org-scoped, only visible once orgA1 is selected

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const sessionIdBefore = decodeClaims(tokens.accessToken).sessionId;

      // Before switching, the org-scoped MEMBER grant is invisible (Phase 2A behavior, unchanged for tenant-wide resolution).
      const meBefore = await me(tokens.accessToken);
      expect(meBefore.body.roles).toEqual([]);

      const switchRes = await switchContext(tokens.accessToken, orgA1.id);
      expect(switchRes.status).toBe(200);
      expect(switchRes.body.accessToken).toBeDefined();
      const claims = decodeClaims(switchRes.body.accessToken);
      expect(claims.organizationId).toBe(orgA1.id);
      expect(claims.tenantId).toBe(tenantA.id);
      expect(claims.sessionId).toBe(sessionIdBefore); // same-tenant switch mutates the session in place, never creates a new one

      const meAfter = await me(switchRes.body.accessToken);
      expect(meAfter.body.organizationContext).toEqual({ organizationId: orgA1.id, organizationName: 'Org A1' });
      expect(meAfter.body.roles.map((r: { roleCode: string }) => r.roleCode)).toContain('MEMBER');

      // The pre-switch refresh token is invalidated — switching always reissues a fresh token pair.
      const staleRefresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(staleRefresh.status).toBe(401);
    });

    it('clearing context returns to tenant-wide, on the same session', async () => {
      const user = await createGlobalUser(`clearer-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const switchRes = await switchContext(tokens.accessToken, orgA1.id);
      expect(switchRes.status).toBe(200);

      const clearRes = await clearContext(switchRes.body.accessToken);
      expect(clearRes.status).toBe(200);
      const claims = decodeClaims(clearRes.body.accessToken);
      expect(claims.organizationId).toBeNull();
      expect(claims.sessionId).toBe(decodeClaims(switchRes.body.accessToken).sessionId);

      const meAfter = await me(clearRes.body.accessToken);
      expect(meAfter.body.organizationContext).toEqual({ organizationId: null, organizationName: null });
    });
  });

  describe('Cross-tenant context switch', () => {
    it('switching to an organization in a DIFFERENT tenant revokes the old session and issues a new one in the target tenant', async () => {
      const user = await createGlobalUser(`crosstenant-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantB.id, orgB1.id, user.id, 'ACTIVE');

      const tokensA = await loginOk(tenantA.tenantCode, user.email);
      const sessionIdA = decodeClaims(tokensA.accessToken).sessionId;

      const switchRes = await switchContext(tokensA.accessToken, orgB1.id);
      expect(switchRes.status).toBe(200);
      const claims = decodeClaims(switchRes.body.accessToken);
      expect(claims.tenantId).toBe(tenantB.id);
      expect(claims.organizationId).toBe(orgB1.id);
      expect(claims.sessionId).not.toBe(sessionIdA); // a genuinely new session, in the target tenant's own RLS partition

      // The old Tenant A session is revoked.
      const oldSession = await prismaContext.runInContext((tx) => tx.securitySession.findUnique({ where: { id: sessionIdA as string } }), tenantA.id);
      expect(oldSession?.revokedAt).not.toBeNull();

      // The pre-switch refresh token no longer works.
      const staleRefresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: tokensA.refreshToken });
      expect(staleRefresh.status).toBe(401);

      // The caller is now genuinely operating in Tenant B.
      const meAfter = await me(switchRes.body.accessToken);
      expect(meAfter.body.tenant.id).toBe(tenantB.id);
      expect(meAfter.body.organizationContext.organizationId).toBe(orgB1.id);
    });
  });

  describe('Negative / security — a client-supplied organizationId can never grant access it should not', () => {
    it('switching to an organization the caller has NO membership in is denied (403), and audited', async () => {
      const user = await createGlobalUser(`nomembership-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      // orgA2 exists, but this user has no membership there at all.
      const res = await switchContext(tokens.accessToken, orgA2.id);
      expect(res.status).toBe(403);

      const denyEvent = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findFirst({ where: { tenantId: tenantA.id, eventType: 'organization_context.denied', resourceId: orgA2.id } }),
        tenantA.id,
      );
      expect(denyEvent).not.toBeNull();

      // The session/context is unaffected by the denied attempt.
      const meAfter = await me(tokens.accessToken);
      expect(meAfter.body.organizationContext.organizationId).toBeNull();
    });

    it('switching to a nonexistent organizationId is denied the same way (no information leak about which case failed)', async () => {
      const user = await createGlobalUser(`nonexistentorg-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await switchContext(tokens.accessToken, randomUUID());
      expect(res.status).toBe(403);
    });

    it('an INVITED (not yet ACTIVE) membership cannot be used to select that organization as context', async () => {
      const user = await createGlobalUser(`invited-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE'); // needs at least one ACTIVE membership to log in at all
      await addMembership(tenantA.id, orgA2.id, user.id, 'INVITED');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await switchContext(tokens.accessToken, orgA2.id);
      expect(res.status).toBe(403);
    });

    it('a SUSPENDED membership cannot be used to select that organization as context', async () => {
      const user = await createGlobalUser(`suspendedmember-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, orgA2.id, user.id, 'SUSPENDED');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await switchContext(tokens.accessToken, orgA2.id);
      expect(res.status).toBe(403);
    });

    it('an organization with status INACTIVE cannot be selected as context even with an ACTIVE membership', async () => {
      const disabledOrg = await prismaContext.runInContext(
        (tx) =>
          tx.organization.create({
            data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: `ORG-DISABLED-${suffix}`, organizationName: 'Disabled Org', status: 'INACTIVE' },
          }),
        tenantA.id,
      );
      const user = await createGlobalUser(`disabledorg-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, disabledOrg.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await switchContext(tokens.accessToken, disabledOrg.id);
      expect(res.status).toBe(403);
    });

    it('a SUSPENDED tenant cannot be entered via cross-tenant switch', async () => {
      const suspendedTenant = await prisma.tenant.create({ data: { tenantCode: `P2C-SUSP-${suffix}`, tenantName: 'Suspended Tenant', status: 'SUSPENDED' } });
      const suspendedOrg = await prismaContext.runInContext(
        (tx) => tx.organization.create({ data: { tenantId: suspendedTenant.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-SUSP', organizationName: 'Org in suspended tenant' } }),
        suspendedTenant.id,
      );

      const user = await createGlobalUser(`suspendedtenant-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(suspendedTenant.id, suspendedOrg.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await switchContext(tokens.accessToken, suspendedOrg.id);
      expect(res.status).toBe(403);
    });
  });

  describe('Live re-validation on refresh — a stale context never survives a token refresh', () => {
    it('a membership revoked mid-session is caught on the next refresh, clearing the selected organization', async () => {
      const user = await createGlobalUser(`staleref-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, orgA2.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const switchRes = await switchContext(tokens.accessToken, orgA2.id);
      expect(switchRes.status).toBe(200);
      expect(decodeClaims(switchRes.body.accessToken).organizationId).toBe(orgA2.id);

      // Membership in orgA2 is revoked mid-session — simulating an admin action elsewhere.
      await prismaContext.runInContext(
        (tx) => tx.membership.updateMany({ where: { tenantId: tenantA.id, organizationId: orgA2.id, userId: user.id }, data: { status: 'SUSPENDED' } }),
        tenantA.id,
      );

      const refreshRes = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: switchRes.body.refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(decodeClaims(refreshRes.body.accessToken).organizationId).toBeNull();

      const staleClearedEvent = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findFirst({ where: { tenantId: tenantA.id, eventType: 'organization_context.cleared_stale', actorUserId: user.id } }),
        tenantA.id,
      );
      expect(staleClearedEvent).not.toBeNull();

      // The session row itself reflects the clear, not just the token.
      const session = await prismaContext.runInContext(
        (tx) => tx.securitySession.findUnique({ where: { id: decodeClaims(refreshRes.body.accessToken).sessionId as string } }),
        tenantA.id,
      );
      expect(session?.organizationId).toBeNull();
    });

    it('an organization disabled mid-session is caught on the next refresh the same way', async () => {
      const org = await prismaContext.runInContext(
        (tx) =>
          tx.organization.create({
            data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: `ORG-GOESDOWN-${suffix}`, organizationName: 'Org that goes down' },
          }),
        tenantA.id,
      );
      const user = await createGlobalUser(`orggoesdown-${suffix}@example.com`);
      await addMembership(tenantA.id, org.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const switchRes = await switchContext(tokens.accessToken, org.id);
      expect(switchRes.status).toBe(200);

      await prismaContext.runInContext((tx) => tx.organization.update({ where: { id: org.id }, data: { status: 'INACTIVE' } }), tenantA.id);

      const refreshRes = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: switchRes.body.refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(decodeClaims(refreshRes.body.accessToken).organizationId).toBeNull();
    });

    it('a still-valid organization context survives refresh unchanged', async () => {
      const user = await createGlobalUser(`stillvalid-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const switchRes = await switchContext(tokens.accessToken, orgA1.id);
      const refreshRes = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: switchRes.body.refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(decodeClaims(refreshRes.body.accessToken).organizationId).toBe(orgA1.id);
    });
  });

  describe('GET /me/organizations — cross-tenant discovery, without ever trusting a client-supplied tenantId', () => {
    it('lists every ACTIVE membership across every tenant, and only ACTIVE ones', async () => {
      const user = await createGlobalUser(`listorgs-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, orgA2.id, user.id, 'INVITED'); // must NOT appear
      await addMembership(tenantB.id, orgB1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await request(app.getHttpServer()).get('/api/v1/me/organizations').set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(res.status).toBe(200);
      const orgIds = res.body.map((o: { organizationId: string }) => o.organizationId);
      expect(orgIds).toEqual(expect.arrayContaining([orgA1.id, orgB1.id]));
      expect(orgIds).not.toContain(orgA2.id);

      const entryB = res.body.find((o: { organizationId: string }) => o.organizationId === orgB1.id);
      expect(entryB.tenantId).toBe(tenantB.id);
      expect(entryB.tenantCode).toBe(tenantB.tenantCode);
    });

    it('GET /me/context reflects the same tenant/organizationContext as GET /auth/me', async () => {
      const user = await createGlobalUser(`mecontext-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const switchRes = await switchContext(tokens.accessToken, orgA1.id);

      const contextRes = await request(app.getHttpServer()).get('/api/v1/me/context').set('Authorization', `Bearer ${switchRes.body.accessToken}`);
      expect(contextRes.status).toBe(200);
      expect(contextRes.body).toEqual({
        tenant: { id: tenantA.id, tenantCode: tenantA.tenantCode, tenantName: tenantA.tenantName },
        organizationContext: { organizationId: orgA1.id, organizationName: 'Org A1' },
      });
    });
  });

  describe('Concurrency', () => {
    it('two concurrent switch requests on the same session both resolve without corrupting session state', async () => {
      const user = await createGlobalUser(`concurrent-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, orgA2.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const [res1, res2] = await Promise.all([switchContext(tokens.accessToken, orgA1.id), switchContext(tokens.accessToken, orgA2.id)]);

      // Both requests were authorized (the caller has ACTIVE membership in both) — neither should fail with a server error.
      expect([res1.status, res2.status]).toEqual([200, 200]);

      // Whichever wrote last, the session's organizationId is one of the two valid targets, never a corrupted/mixed value.
      const sessionId = decodeClaims(res1.body.accessToken).sessionId as string;
      const session = await prismaContext.runInContext((tx) => tx.securitySession.findUnique({ where: { id: sessionId } }), tenantA.id);
      expect([orgA1.id, orgA2.id]).toContain(session?.organizationId);
    });
  });

  describe('RLS — the membership self-visibility carve-out never exposes another user\'s memberships', () => {
    it('a user cannot switch into an organization using another user\'s membership as leverage', async () => {
      const owner = await createGlobalUser(`owner-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA2.id, owner.id, 'ACTIVE'); // owner is the only member of orgA2

      const outsider = await createGlobalUser(`outsider-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, outsider.id, 'ACTIVE'); // outsider has no relationship to orgA2 at all
      const outsiderTokens = await loginOk(tenantA.tenantCode, outsider.email);

      const res = await switchContext(outsiderTokens.accessToken, orgA2.id);
      expect(res.status).toBe(403);
    });
  });
});
