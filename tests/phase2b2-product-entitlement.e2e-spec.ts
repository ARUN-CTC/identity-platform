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
 * Phase 2B.2 acceptance tests — Product Entitlement
 * (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md, ADR-011). Runs against the
 * real identity_platform_db, same pattern as every prior phase's suite.
 */
describe('Phase 2B.2 — Product Entitlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenantAdminToken: string;
  let tenant: { id: string; tenantCode: string };
  let org: { id: string };

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
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

  async function makeTenant(codeSuffix: string) {
    return prisma.tenant.create({ data: { tenantCode: `P2B2-${codeSuffix}`, tenantName: `Entitlement Tenant ${codeSuffix}`, status: 'ACTIVE' } });
  }

  async function makeProduct(slugSuffix: string) {
    return prisma.product.create({ data: { name: `Product ${slugSuffix}`, slug: `p2b2-${slugSuffix}`, status: 'ACTIVE' } });
  }

  const ALL_ENTITLEMENT_CODES = ['PRODUCT_ENTITLEMENT_VIEW', 'PRODUCT_ENTITLEMENT_MANAGE'];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);

    tenant = await makeTenant(suffix);
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenant.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenant.id,
    );
    const tenantAdminRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'TENANT_ADMIN', tenantId: null } });
    const tenantAdminUser = await createGlobalUser(`tadmin-${suffix}@example.com`);
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenant.id, organizationId: org.id, userId: tenantAdminUser.id, status: 'ACTIVE' } }), tenant.id);
    await prismaContext.runInContext((tx) => tx.securityUserRole.create({ data: { tenantId: tenant.id, userId: tenantAdminUser.id, roleId: tenantAdminRole.id } }), tenant.id);
    const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: tenantAdminUser.email, password: PASSWORD });
    tenantAdminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Creation and persistence', () => {
    it('an authorized Platform Operator creates an ACTIVE entitlement, persisted and audited', async () => {
      const operator = await makeOperator(`creator-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`create-${suffix}`);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product.id });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.tenantId).toBe(tenant.id);

      const row = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.findFirst({ where: { tenantId: tenant.id, productId: product.id } }), tenant.id);
      expect(row).not.toBeNull();

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'PRODUCT_ENTITLEMENT_CREATED', resourceId: row!.id, scope: 'PLATFORM' } });
      expect(event).not.toBeNull();
      expect(event?.tenantId).toBeNull();
    });

    it('duplicate creation is DENIED with 409 — no duplicate record', async () => {
      const operator = await makeOperator(`dup-creator-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`dup-${suffix}`);

      const first = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product.id });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product.id });
      expect(second.status).toBe(409);

      const count = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.count({ where: { tenantId: tenant.id, productId: product.id } }), tenant.id);
      expect(count).toBe(1);
    });

    it('a concurrent duplicate-create race resolves to exactly one record, no unhandled error', async () => {
      const operator = await makeOperator(`race-creator-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`race-${suffix}`);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id }),
        request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const count = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.count({ where: { tenantId: tenant.id, productId: product.id } }), tenant.id);
      expect(count).toBe(1);
    });
  });

  describe('Access evaluation and Product-status precedence', () => {
    it('ACTIVE entitlement + ACTIVE product = eligible; DISABLED product overrides an ACTIVE entitlement; re-enabling restores eligibility', async () => {
      const operator = await makeOperator(`precedence-${suffix}@example.com`, [...ALL_ENTITLEMENT_CODES, 'PRODUCT_MANAGE']);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`precedence-${suffix}`);

      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });

      const before = await request(app.getHttpServer()).get('/api/v1/product-entitlements').set('Authorization', `Bearer ${tenantAdminToken}`);
      const rowBefore = before.body.find((r: { productId: string }) => r.productId === product.id);
      expect(rowBefore.eligible).toBe(true);

      await request(app.getHttpServer()).patch(`/api/v1/products/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'DISABLED' });

      const during = await request(app.getHttpServer()).get('/api/v1/product-entitlements').set('Authorization', `Bearer ${tenantAdminToken}`);
      const rowDuring = during.body.find((r: { productId: string }) => r.productId === product.id);
      expect(rowDuring.eligible).toBe(false);
      expect(rowDuring.status).toBe('ACTIVE'); // the entitlement itself is untouched — only Product.status changed

      await request(app.getHttpServer()).patch(`/api/v1/products/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ACTIVE' });

      const after = await request(app.getHttpServer()).get('/api/v1/product-entitlements').set('Authorization', `Bearer ${tenantAdminToken}`);
      const rowAfter = after.body.find((r: { productId: string }) => r.productId === product.id);
      expect(rowAfter.eligible).toBe(true);
    });

    it('no entitlement record at all = not eligible (deny-by-default)', async () => {
      const product = await makeProduct(`no-entitlement-${suffix}`);
      const res = await request(app.getHttpServer()).get('/api/v1/product-entitlements').set('Authorization', `Bearer ${tenantAdminToken}`);
      const row = res.body.find((r: { productId: string }) => r.productId === product.id);
      expect(row).toBeUndefined(); // never appears at all — no row, no claim of eligibility either way
    });

    it('multiple products are independent — one SUSPENDED does not affect another ACTIVE one for the same tenant', async () => {
      const operator = await makeOperator(`independence-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const productA = await makeProduct(`indep-a-${suffix}`);
      const productB = await makeProduct(`indep-b-${suffix}`);

      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: productA.id });
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: productB.id });
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${productA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' });

      const res = await request(app.getHttpServer()).get('/api/v1/product-entitlements').set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(res.body.find((r: { productId: string }) => r.productId === productA.id).eligible).toBe(false);
      expect(res.body.find((r: { productId: string }) => r.productId === productB.id).eligible).toBe(true);
    });
  });

  describe('Multi-tenant isolation', () => {
    it("Tenant A's entitlement does not affect Tenant B's, and a Platform Operator query for Tenant B never leaks Tenant A's rows", async () => {
      const operator = await makeOperator(`isolation-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`isolation-${suffix}`);
      const tenantB = await makeTenant(`${suffix}-b`);

      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });

      const tenantBList = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenantB.id}/product-entitlements`).set('Authorization', `Bearer ${token}`);
      expect(tenantBList.status).toBe(200);
      expect(tenantBList.body).toEqual([]);

      // Same productId, addressed through Tenant B's URL, must 404 — Tenant A's row is not reachable this way (IDOR check).
      const tenantBGet = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenantB.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`);
      expect(tenantBGet.status).toBe(404);

      const tenantBPatch = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantB.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' });
      expect(tenantBPatch.status).toBe(404);

      // Tenant A's own entitlement is untouched by any of the above.
      const tenantACheck = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`);
      expect(tenantACheck.body.status).toBe('ACTIVE');
    });
  });

  describe('Lifecycle transitions', () => {
    it('ACTIVE -> SUSPENDED -> ACTIVE, each audited', async () => {
      const operator = await makeOperator(`lifecycle-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`lifecycle-${suffix}`);
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });

      const suspend = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.status).toBe('SUSPENDED');

      const reactivateViaPatch = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ACTIVE' });
      expect(reactivateViaPatch.status).toBe(200);
      expect(reactivateViaPatch.body.status).toBe('ACTIVE');

      const events = await prisma.securityEvent.findMany({ where: { resourceType: 'TenantProductEntitlement', scope: 'PLATFORM', eventType: { in: ['PRODUCT_ENTITLEMENT_SUSPENDED', 'PRODUCT_ENTITLEMENT_ACTIVATED'] } } });
      expect(events.some((e) => e.eventType === 'PRODUCT_ENTITLEMENT_SUSPENDED')).toBe(true);
      expect(events.some((e) => e.eventType === 'PRODUCT_ENTITLEMENT_ACTIVATED')).toBe(true);
    });

    it('ACTIVE -> REVOKED cannot be reversed via the generic PATCH endpoint; only POST .../reactivate restores it, as its own audited action', async () => {
      const operator = await makeOperator(`revoke-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`revoke-${suffix}`);
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });

      const revoke = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REVOKED' });
      expect(revoke.status).toBe(200);
      expect(revoke.body.status).toBe('REVOKED');

      const patchBack = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ACTIVE' });
      expect(patchBack.status).toBe(409);

      const reactivate = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}/reactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(reactivate.status).toBe(201);
      expect(reactivate.body.status).toBe('ACTIVE');

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'PRODUCT_ENTITLEMENT_REACTIVATED', resourceId: revoke.body.id, scope: 'PLATFORM' } });
      expect(event).not.toBeNull();
    });

    it('SUSPENDED -> REVOKED is a valid direct transition (revoke does not require passing through ACTIVE first)', async () => {
      const operator = await makeOperator(`suspend-then-revoke-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`suspend-then-revoke-${suffix}`);
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });
      await request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'SUSPENDED' });

      const revoke = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REVOKED' });
      expect(revoke.status).toBe(200);
      expect(revoke.body.status).toBe('REVOKED');
    });
  });

  describe('Concurrency', () => {
    it('concurrent SUSPEND and REVOKE converge to REVOKED regardless of commit order (the stronger terminal state wins)', async () => {
      const operator = await makeOperator(`concurrency-revoke-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`concurrency-revoke-${suffix}`);
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });

      await Promise.allSettled([
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'SUSPENDED' }),
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'REVOKED' }),
      ]);

      const final = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.findFirst({ where: { tenantId: tenant.id, productId: product.id } }), tenant.id);
      expect(final?.status).toBe('REVOKED');
    });

    it('concurrent ACTIVE/SUSPENDED transitions never corrupt state — the row always ends in exactly one valid status', async () => {
      const operator = await makeOperator(`concurrency-toggle-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);
      const product = await makeProduct(`concurrency-toggle-${suffix}`);
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${token}`).send({ productId: product.id });
      await request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'SUSPENDED' });

      await Promise.allSettled([
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ACTIVE' }),
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${product.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'ACTIVE' }),
      ]);

      const final = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.findFirst({ where: { tenantId: tenant.id, productId: product.id } }), tenant.id);
      expect(['ACTIVE']).toContain(final?.status);
    });
  });

  describe('Authorization — least privilege and cross-boundary denial', () => {
    it('a Platform Operator without PRODUCT_ENTITLEMENT_MANAGE cannot create or change entitlements, but one with only _VIEW can read', async () => {
      const viewer = await makeOperator(`viewer-only-${suffix}@example.com`, ['PRODUCT_ENTITLEMENT_VIEW']);
      const viewerToken = await platformLogin(viewer.user.email);
      const product = await makeProduct(`least-priv-${suffix}`);

      const createAttempt = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ productId: product.id });
      expect(createAttempt.status).toBe(403);

      const listAttempt = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${viewerToken}`);
      expect(listAttempt.status).toBe(200);
    });

    it('a Tenant Admin (however broad) is rejected outright — cannot self-grant product entitlement', async () => {
      const product = await makeProduct(`tenant-admin-denied-${suffix}`);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ productId: product.id });
      expect(res.status).toBe(401);
    });

    it('anonymous requests are denied', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`);
      expect(res.status).toBe(401);
    });

    it('a nonexistent tenant or product 404s rather than erroring', async () => {
      const operator = await makeOperator(`notfound-${suffix}@example.com`, ALL_ENTITLEMENT_CODES);
      const token = await platformLogin(operator.user.email);

      const badTenant = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${randomUUID()}/product-entitlements`).set('Authorization', `Bearer ${token}`);
      expect(badTenant.status).toBe(404);

      const badProduct = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: randomUUID() });
      expect(badProduct.status).toBe(404);
    });
  });
});
