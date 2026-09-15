import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { AccessTokenClaims, TokenService } from '../src/modules/jwt/services';

/**
 * Phase 2C Stabilization & Security Hardening — independent post-
 * implementation audit tests. These are deliberately NOT a restatement of
 * tests/phase2c-organization-context.e2e-spec.ts — every test here targets
 * an invariant that suite does not directly exercise: forged-but-validly-
 * signed JWT claims, cross-tenant/cross-organization claim mismatches,
 * CLS/async-context isolation under real concurrency, and Platform Operator
 * separation from organization membership.
 */
describe('Phase 2C Stabilization — Security Hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let tokenService: TokenService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenantA: { id: string; tenantCode: string; tenantName: string };
  let tenantB: { id: string; tenantCode: string; tenantName: string };
  let orgA1: { id: string };
  let orgA2: { id: string };
  let orgB1: { id: string };
  let orgTypeId: string;
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
    return prismaContext.runInContext((tx) => tx.securityUserRole.create({ data: { tenantId, userId, roleId, organizationId } }), tenantId);
  }

  async function loginOk(tenantCode: string, email: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode, email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function me(accessToken: string): Promise<request.Response> {
    return request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
  }

  /** Decodes a JWT's payload without verifying it, stripping iat/exp so the result can be re-signed via signAccessToken (which sets its own expiresIn and rejects a payload that already carries `exp`). */
  function decodeClaimsForResign(jwt: string): AccessTokenClaims {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    delete payload.iat;
    delete payload.exp;
    return payload;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    tokenService = app.get(TokenService);

    tenantA = await prisma.tenant.create({ data: { tenantCode: `P2CS-A-${suffix}`, tenantName: 'Stabilization Tenant A', status: 'ACTIVE' } });
    tenantB = await prisma.tenant.create({ data: { tenantCode: `P2CS-B-${suffix}`, tenantName: 'Stabilization Tenant B', status: 'ACTIVE' } });

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

    const memberRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'MEMBER', tenantId: null } });
    memberRoleId = memberRole.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('I7 — a validly-signed JWT with a forged organizationId claim confers no more than the database independently confirms', () => {
    it('a claim naming an organization the caller has NO membership in resolves to zero org-scoped grants, not an error and not a leak', async () => {
      const user = await createGlobalUser(`forged-noorg-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      // The user is deliberately never given membership in orgA2.
      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const claims = decodeClaimsForResign(tokens.accessToken);

      // Forge a token with the SAME (valid) signing secret this process holds
      // (simulating a legitimate token whose claims were tampered with, or a
      // stale/replayed token from a different context) — organizationId now
      // names an organization this Identity has no relationship to at all.
      const forged = tokenService.signAccessToken({ ...claims, organizationId: orgA2.id });

      const meRes = await me(forged);
      expect(meRes.status).toBe(200); // authentication succeeds — the session itself is still valid
      expect(meRes.body.organizationContext).toEqual({ organizationId: null, organizationName: null }); // but the org context does not
      expect(meRes.body.roles).toEqual([]); // and no org-scoped grant for orgA2 is resolved
    });

    it('a claim naming an organization in a DIFFERENT tenant than the token\'s own tenantId resolves to zero org-scoped grants', async () => {
      const user = await createGlobalUser(`forged-wrongtenant-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantB.id, orgB1.id, user.id, 'ACTIVE');
      await grantRole(tenantB.id, user.id, memberRoleId, orgB1.id); // a REAL org-scoped grant, but only under tenantB

      const tokens = await loginOk(tenantA.tenantCode, user.email); // tenantId = tenantA in this token
      const claims = decodeClaimsForResign(tokens.accessToken);

      // Forge: keep tenantId = tenantA (the token's own, real tenant) but
      // claim organizationId = orgB1, which belongs to tenantB. The
      // Membership genuinely exists — but not under the claimed tenant.
      const forged = tokenService.signAccessToken({ ...claims, organizationId: orgB1.id });

      const meRes = await me(forged);
      expect(meRes.status).toBe(200);
      expect(meRes.body.organizationContext).toEqual({ organizationId: null, organizationName: null });
      expect(meRes.body.roles).toEqual([]); // the real orgB1 MEMBER grant must NOT leak into a tenantA-scoped request
    });

    it('another user\'s organizationId claim, forged onto this user\'s own valid token, grants nothing (the membership check is keyed to the token\'s own sub, not merely the presence of a claim)', async () => {
      const owner = await createGlobalUser(`forged-owner-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA2.id, owner.id, 'ACTIVE');
      await grantRole(tenantA.id, owner.id, memberRoleId, orgA2.id);

      const outsider = await createGlobalUser(`forged-outsider-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, outsider.id, 'ACTIVE');
      const outsiderTokens = await loginOk(tenantA.tenantCode, outsider.email);
      const claims = decodeClaimsForResign(outsiderTokens.accessToken);

      // outsider's own token (sub = outsider), forged to claim orgA2 — the
      // organization owner (a DIFFERENT user) actually belongs to.
      const forged = tokenService.signAccessToken({ ...claims, organizationId: orgA2.id });

      const meRes = await me(forged);
      expect(meRes.status).toBe(200);
      expect(meRes.body.organizationContext).toEqual({ organizationId: null, organizationName: null });
      expect(meRes.body.roles).toEqual([]);
    });
  });

  describe('I2/I5/I6 — PermissionsGuard: organization-scoped grants never cross organization or tenant boundaries', () => {
    it('the SAME user with DIFFERENT roles in two organizations of the SAME tenant only ever sees the grant for the org actually selected', async () => {
      const adminRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'TENANT_ADMIN', tenantId: null } });
      const user = await createGlobalUser(`samet-diffrole-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantA.id, orgA2.id, user.id, 'ACTIVE');
      await grantRole(tenantA.id, user.id, adminRole.id, orgA1.id); // org-scoped ADMIN in A1
      await grantRole(tenantA.id, user.id, memberRoleId, orgA2.id); // org-scoped MEMBER in A2

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const switchToA1 = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ organizationId: orgA1.id });
      const meA1 = await me(switchToA1.body.accessToken);
      expect(meA1.body.roles.map((r: { roleCode: string }) => r.roleCode)).toEqual(['TENANT_ADMIN']);

      const switchToA2 = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${switchToA1.body.accessToken}`)
        .send({ organizationId: orgA2.id });
      const meA2 = await me(switchToA2.body.accessToken);
      expect(meA2.body.roles.map((r: { roleCode: string }) => r.roleCode)).toEqual(['MEMBER']);
      // Never both at once, and never the other organization's grant.
      expect(meA2.body.roles.map((r: { roleCode: string }) => r.roleCode)).not.toContain('TENANT_ADMIN');
    });

    it('a role granted in Organization A never authorizes anything once the context is switched to Organization B, even mid-permission-gated-request-sequence', async () => {
      const user = await createGlobalUser(`crosstenantrole-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      await addMembership(tenantB.id, orgB1.id, user.id, 'ACTIVE');
      await grantRole(tenantA.id, user.id, memberRoleId, orgA1.id);
      // Deliberately NO grant at all in tenantB/orgB1.

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const switchToA1 = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ organizationId: orgA1.id });
      expect((await me(switchToA1.body.accessToken)).body.roles.map((r: { roleCode: string }) => r.roleCode)).toContain('MEMBER');

      const switchToB1 = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${switchToA1.body.accessToken}`)
        .send({ organizationId: orgB1.id });
      expect(switchToB1.status).toBe(200); // cross-tenant switch itself succeeds — membership is real
      const meB1 = await me(switchToB1.body.accessToken);
      expect(meB1.body.roles).toEqual([]); // but the ORG A1 grant does not follow the user into tenant B
    });
  });

  describe('I10 — CLS/async-context isolation under real concurrency (deliberately delayed, interleaved requests)', () => {
    it('many concurrent /auth/me + /me/context requests across two distinct tenant/organization contexts never cross-contaminate', async () => {
      const userX = await createGlobalUser(`cls-x-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, userX.id, 'ACTIVE');
      const tokensX = await loginOk(tenantA.tenantCode, userX.email);
      const switchX = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokensX.accessToken}`)
        .send({ organizationId: orgA1.id });

      const userY = await createGlobalUser(`cls-y-${suffix}@example.com`);
      await addMembership(tenantB.id, orgB1.id, userY.id, 'ACTIVE');
      const tokensY = await loginOk(tenantB.tenantCode, userY.email);
      const switchY = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokensY.accessToken}`)
        .send({ organizationId: orgB1.id });

      const tokenX = switchX.body.accessToken as string;
      const tokenY = switchY.body.accessToken as string;

      // Interleave many concurrent requests for both identities at once —
      // if nestjs-cls / PrismaContextService / any repository ever leaked
      // context between concurrent requests, at least one of these would
      // come back with the WRONG tenant/organization for its own token.
      const ITERATIONS = 4;
      const calls: Promise<{ who: 'X' | 'Y'; res: request.Response }>[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        calls.push(me(tokenX).then((res) => ({ who: 'X' as const, res })));
        calls.push(me(tokenY).then((res) => ({ who: 'Y' as const, res })));
        calls.push(
          request(app.getHttpServer())
            .get('/api/v1/me/context')
            .set('Authorization', `Bearer ${tokenX}`)
            .then((res) => ({ who: 'X' as const, res })),
        );
        calls.push(
          request(app.getHttpServer())
            .get('/api/v1/me/context')
            .set('Authorization', `Bearer ${tokenY}`)
            .then((res) => ({ who: 'Y' as const, res })),
        );
      }

      const results = await Promise.all(calls);
      expect(results).toHaveLength(ITERATIONS * 4);

      for (const { who, res } of results) {
        expect(res.status).toBe(200);
        if (who === 'X') {
          expect(res.body.tenant.id).toBe(tenantA.id);
          expect(res.body.organizationContext.organizationId).toBe(orgA1.id);
        } else {
          expect(res.body.tenant.id).toBe(tenantB.id);
          expect(res.body.organizationContext.organizationId).toBe(orgB1.id);
        }
      }
    });
  });

  describe('I11 — Platform Operator status never silently becomes organization Membership', () => {
    it('a Platform Operator with zero Memberships sees an empty organization list and cannot log in through the tenant-scoped login endpoint', async () => {
      const user = await createGlobalUser(`operator-noorg-${suffix}@example.com`);
      await prisma.platformOperator.create({ data: { userId: user.id, status: 'ACTIVE' } });
      // Deliberately: no membership row of any kind is created for this user.

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantCode: tenantA.tenantCode, email: user.email, password: PASSWORD });
      expect(loginRes.status).toBe(401); // being a Platform Operator confers no tenant-scoped Membership
    });

    it('a Platform Operator who ALSO happens to hold a real tenant Membership only ever gets the access that Membership independently grants — operator status adds nothing to it', async () => {
      const user = await createGlobalUser(`operator-withorg-${suffix}@example.com`);
      await prisma.platformOperator.create({ data: { userId: user.id, status: 'ACTIVE' } });
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE'); // an independent, ordinary Membership grant

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const orgsRes = await request(app.getHttpServer()).get('/api/v1/me/organizations').set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(orgsRes.status).toBe(200);
      expect(orgsRes.body).toHaveLength(1);
      expect(orgsRes.body[0].organizationId).toBe(orgA1.id);

      // No elevated/admin permission leaks in merely from being an operator.
      const meRes = await me(tokens.accessToken);
      expect(meRes.body.roles).toEqual([]);
    });
  });

  describe('Audit ordering — a success event is never recorded ahead of the operation it describes actually completing', () => {
    it('a successful switch records exactly one organization_context.switched event, attributed to the resulting session', async () => {
      const user = await createGlobalUser(`auditordering-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const switchRes = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ organizationId: orgA1.id });
      expect(switchRes.status).toBe(200);

      const events = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findMany({ where: { tenantId: tenantA.id, eventType: 'organization_context.switched', actorUserId: user.id } }),
        tenantA.id,
      );
      expect(events).toHaveLength(1);
      const claims = JSON.parse(Buffer.from((switchRes.body.accessToken as string).split('.')[1], 'base64url').toString());
      expect((events[0].metadata as Record<string, unknown>).sessionId).toBe(claims.sessionId);
    });

    it('a denied switch never records a switched event, only a denied one', async () => {
      const user = await createGlobalUser(`auditdenied-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA1.id, user.id, 'ACTIVE');
      const tokens = await loginOk(tenantA.tenantCode, user.email);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/context/switch')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ organizationId: orgA2.id }); // no membership there
      expect(res.status).toBe(403);

      const switched = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findMany({ where: { tenantId: tenantA.id, eventType: 'organization_context.switched', actorUserId: user.id } }),
        tenantA.id,
      );
      expect(switched).toHaveLength(0);
      const denied = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findMany({ where: { tenantId: tenantA.id, eventType: 'organization_context.denied', actorUserId: user.id } }),
        tenantA.id,
      );
      expect(denied).toHaveLength(1);
    });
  });
});
