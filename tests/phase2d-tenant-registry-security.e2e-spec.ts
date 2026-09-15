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
 * Phase 2D — Tenant Registry security remediation acceptance tests
 * (docs/... [[tenant-manage-unscoped-registry-vulnerability]]).
 *
 * Prior behavior (the vulnerability): `TenantsController` exposed
 * `GET/PATCH/DELETE /tenants/:id` (+ activate/suspend) gated only by the
 * tenant-grantable `TENANT_MANAGE`, with zero ownership check — any
 * tenant's own SUPER_ADMIN could read/modify/suspend/delete ANY OTHER
 * tenant by UUID.
 *
 * Fixed shape verified here:
 *   - `/tenants/me` (GET/PATCH) — tenant self-service, tenantId ALWAYS
 *     resolved from the caller's own JWT (RequestContextService), never a
 *     path param — there is no id parameter on this controller at all for
 *     an attacker to substitute.
 *   - `/platform/tenants[...]` — the full registry (list/get/create/update/
 *     activate/suspend/delete by id), reachable ONLY by a genuine Platform
 *     Operator token holding the new, platform_only PLATFORM_TENANT_VIEW/
 *     PLATFORM_TENANT_MANAGE permissions. A tenant-scoped token — however
 *     broad, including one holding TENANT_MANAGE — is rejected outright
 *     (401) by PlatformJwtAuthGuard, never merely denied a permission.
 */
describe('Phase 2D — Tenant Registry security remediation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenantA: { id: string; tenantCode: string; tenantName: string };
  let tenantB: { id: string; tenantCode: string; tenantName: string };
  let orgA: { id: string };

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
  }

  async function makeTenant(codeSuffix: string) {
    return prisma.tenant.create({ data: { tenantCode: `P2D-${codeSuffix}`, tenantName: `Registry Tenant ${codeSuffix}`, status: 'ACTIVE' } });
  }

  /** A tenant user with the given system role (SUPER_ADMIN or TENANT_ADMIN) in tenantA's default org, logged in — returns their access token. */
  async function makeTenantUser(email: string, roleCode: 'SUPER_ADMIN' | 'TENANT_ADMIN'): Promise<string> {
    const user = await createGlobalUser(email);
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenantA.id, organizationId: orgA.id, userId: user.id, status: 'ACTIVE' } }), tenantA.id);
    const role = await prisma.securityRole.findFirstOrThrow({ where: { roleCode, tenantId: null } });
    await prismaContext.runInContext((tx) => tx.securityUserRole.create({ data: { tenantId: tenantA.id, userId: user.id, roleId: role.id } }), tenantA.id);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenantA.tenantCode, email: user.email, password: PASSWORD });
    expect(res.body.data?.accessToken ?? res.body.accessToken).toBeDefined();
    return res.body.data?.accessToken ?? res.body.accessToken;
  }

  async function makeOperator(email: string, permissionCodes: string[]) {
    const user = await createGlobalUser(email);
    const operator = await prisma.platformOperator.create({ data: { userId: user.id, status: 'ACTIVE' } });
    if (permissionCodes.length) {
      const permissions = await prisma.securityPermission.findMany({ where: { permissionCode: { in: permissionCodes } } });
      await prisma.platformOperatorPermission.createMany({ data: permissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    }
    return { user, operator };
  }

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);

    tenantA = await makeTenant(`a-${suffix}`);
    tenantB = await makeTenant(`b-${suffix}`);
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    orgA = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantA.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenantA.id,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Tenant self-service (/tenants/me)', () => {
    it('a tenant user WITHOUT TENANT_MANAGE cannot read or update even their own tenant profile', async () => {
      const token = await makeTenantUser(`no-manage-${suffix}@example.com`, 'TENANT_ADMIN');

      const getRes = await request(app.getHttpServer()).get('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(403);

      const patchRes = await request(app.getHttpServer()).patch('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`).send({ tenantName: 'Nope' });
      expect(patchRes.status).toBe(403);
    });

    it('a tenant admin WITH TENANT_MANAGE reads and updates ONLY their own tenant — never accepts a foreign id', async () => {
      const token = await makeTenantUser(`self-service-${suffix}@example.com`, 'SUPER_ADMIN');

      const getRes = await request(app.getHttpServer()).get('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(tenantA.id);
      expect(getRes.body.data.tenantCode).toBe(tenantA.tenantCode);

      const patchRes = await request(app.getHttpServer()).patch('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`).send({ tenantName: 'Renamed by self-service' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.id).toBe(tenantA.id);
      expect(patchRes.body.data.tenantName).toBe('Renamed by self-service');

      // Tenant B, untouched.
      const tenantBFresh = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantB.id } });
      expect(tenantBFresh.tenantName).toBe(tenantB.tenantName);
    });

    it('rejects a self-service status change — status is not a field on this endpoint at all (400, not silently ignored)', async () => {
      const token = await makeTenantUser(`no-status-${suffix}@example.com`, 'SUPER_ADMIN');
      const res = await request(app.getHttpServer()).patch('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`).send({ status: 'SUSPENDED' });
      expect(res.status).toBe(400);

      const fresh = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA.id } });
      expect(fresh.status).toBe('ACTIVE');
    });

    it('there is no route left on this controller that accepts a tenant id at all — the old IDOR surface is gone, not just permission-checked', async () => {
      const token = await makeTenantUser(`idor-attempt-${suffix}@example.com`, 'SUPER_ADMIN');

      // The exact shape of the original vulnerability: read/modify/suspend/
      // delete tenant B by UUID while authenticated as tenant A.
      const getForeign = await request(app.getHttpServer()).get(`/api/v1/tenants/${tenantB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getForeign.status).toBe(404);

      const listAll = await request(app.getHttpServer()).get('/api/v1/tenants').set('Authorization', `Bearer ${token}`);
      expect(listAll.status).toBe(404);

      const patchForeign = await request(app.getHttpServer()).patch(`/api/v1/tenants/${tenantB.id}`).set('Authorization', `Bearer ${token}`).send({ tenantName: 'Pwned' });
      expect(patchForeign.status).toBe(404);

      const suspendForeign = await request(app.getHttpServer()).post(`/api/v1/tenants/${tenantB.id}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(suspendForeign.status).toBe(404);

      const deleteForeign = await request(app.getHttpServer()).delete(`/api/v1/tenants/${tenantB.id}`).set('Authorization', `Bearer ${token}`);
      expect(deleteForeign.status).toBe(404);

      const tenantBFresh = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantB.id } });
      expect(tenantBFresh.status).toBe('ACTIVE');
      expect(tenantBFresh.tenantName).toBe(tenantB.tenantName);
    });

    it('records a TENANT-scoped TENANT_PROFILE_UPDATED event, visible via the tenant\'s own Security & Audit', async () => {
      const token = await makeTenantUser(`audited-${suffix}@example.com`, 'SUPER_ADMIN');
      await request(app.getHttpServer()).patch('/api/v1/tenants/me').set('Authorization', `Bearer ${token}`).send({ tenantName: 'Audited Update' });

      const events = await request(app.getHttpServer())
        .get('/api/v1/security-audit/events')
        .query({ eventType: 'TENANT_PROFILE_UPDATED' })
        .set('Authorization', `Bearer ${token}`);
      expect(events.status).toBe(200);
      expect(events.body.data.items.some((e: { resourceId: string }) => e.resourceId === tenantA.id)).toBe(true);
    });
  });

  describe('Platform tenant registry (/platform/tenants)', () => {
    it('a tenant-scoped token — even one holding TENANT_MANAGE — is rejected outright (401) by the platform boundary', async () => {
      const token = await makeTenantUser(`boundary-cross-${suffix}@example.com`, 'SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('an authenticated Platform Operator WITHOUT PLATFORM_TENANT_VIEW/MANAGE is denied (403), not merely restricted', async () => {
      const operator = await makeOperator(`no-perm-${suffix}@example.com`, []);
      const token = await platformLogin(operator.user.email);

      const list = await request(app.getHttpServer()).get('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(403);

      const create = await request(app.getHttpServer()).post('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`).send({ tenantCode: `X-${suffix}`, tenantName: 'X' });
      expect(create.status).toBe(403);
    });

    it('an authorized Platform Operator can list, read, update, suspend, reactivate, and delete ANY tenant', async () => {
      const operator = await makeOperator(`full-access-${suffix}@example.com`, ['PLATFORM_TENANT_VIEW', 'PLATFORM_TENANT_MANAGE']);
      const token = await platformLogin(operator.user.email);

      const list = await request(app.getHttpServer()).get('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.data.items.some((t: { id: string }) => t.id === tenantA.id)).toBe(true);
      expect(list.body.data.items.some((t: { id: string }) => t.id === tenantB.id)).toBe(true);

      const getB = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenantB.id}`).set('Authorization', `Bearer ${token}`);
      expect(getB.status).toBe(200);
      expect(getB.body.data.id).toBe(tenantB.id);

      const patchB = await request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenantB.id}`).set('Authorization', `Bearer ${token}`).send({ tenantName: 'Renamed by platform operator' });
      expect(patchB.status).toBe(200);
      expect(patchB.body.data.tenantName).toBe('Renamed by platform operator');

      const suspendB = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantB.id}/suspend`).set('Authorization', `Bearer ${token}`);
      expect(suspendB.status).toBe(200);
      expect(suspendB.body.data.status).toBe('SUSPENDED');

      const activateB = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantB.id}/activate`).set('Authorization', `Bearer ${token}`);
      expect(activateB.status).toBe(200);
      expect(activateB.body.data.status).toBe('ACTIVE');

      const create = await request(app.getHttpServer()).post('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`).send({ tenantCode: `NEW-${suffix}`, tenantName: 'New Tenant' });
      expect(create.status).toBe(201);
      const newTenantId = create.body.data.id;

      const deleteRes = await request(app.getHttpServer()).delete(`/api/v1/platform/tenants/${newTenantId}`).set('Authorization', `Bearer ${token}`);
      expect(deleteRes.status).toBe(200);
      const deleted = await prisma.tenant.findUnique({ where: { id: newTenantId } });
      expect(deleted?.deletedAt).not.toBeNull();
    });

    it('returns 404 for a well-formed but nonexistent tenant UUID, and 400 for a malformed one — never a 500', async () => {
      const operator = await makeOperator(`nf-${suffix}@example.com`, ['PLATFORM_TENANT_VIEW']);
      const token = await platformLogin(operator.user.email);

      const nonexistent = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${randomUUID()}`).set('Authorization', `Bearer ${token}`);
      expect(nonexistent.status).toBe(404);

      const malformed = await request(app.getHttpServer()).get('/api/v1/platform/tenants/not-a-uuid').set('Authorization', `Bearer ${token}`);
      expect(malformed.status).toBe(400);
    });

    it('records a PLATFORM-scoped TENANT_CREATED event — visible via platform audit, never via the tenant-scoped Security & Audit endpoint', async () => {
      const operator = await makeOperator(`platform-audit-${suffix}@example.com`, ['PLATFORM_TENANT_VIEW', 'PLATFORM_TENANT_MANAGE', 'PLATFORM_SECURITY_VIEW']);
      const token = await platformLogin(operator.user.email);

      const create = await request(app.getHttpServer()).post('/api/v1/platform/tenants').set('Authorization', `Bearer ${token}`).send({ tenantCode: `AUD-${suffix}`, tenantName: 'Audited Tenant' });
      expect(create.status).toBe(201);
      const createdId = create.body.data.id;

      const platformEvents = await request(app.getHttpServer())
        .get('/api/v1/platform/audit-events')
        .query({ eventType: 'TENANT_CREATED' })
        .set('Authorization', `Bearer ${token}`);
      expect(platformEvents.status).toBe(200);
      expect(platformEvents.body.data.items.some((e: { resourceId: string }) => e.resourceId === createdId)).toBe(true);

      // Never visible to a tenant caller's own Security & Audit — a platform
      // event's tenantId is NULL by construction (RLS enforces this at the
      // database level, not merely by this endpoint's own WHERE clause).
      const tenantAToken = await makeTenantUser(`platform-audit-checker-${suffix}@example.com`, 'SUPER_ADMIN');
      const tenantEvents = await request(app.getHttpServer())
        .get('/api/v1/security-audit/events')
        .query({ eventType: 'TENANT_CREATED' })
        .set('Authorization', `Bearer ${tenantAToken}`);
      expect(tenantEvents.status).toBe(200);
      expect(tenantEvents.body.data.items.length).toBe(0);
    });
  });
});
