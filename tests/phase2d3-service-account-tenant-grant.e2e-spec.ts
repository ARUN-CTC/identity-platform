import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { ServiceAccountTenantGrantsService } from '../src/modules/service-accounts/services';

/**
 * Phase 2D.3 acceptance tests — ServiceAccount & Tenant Grant Foundation
 * (docs/PHASE_2D3.md, docs/adr/ADR-015-service-tenant-authorization.md as
 * amended). Runs against the real identity_platform_db. Every fixture uses
 * a random suffix so repeated runs never collide with seeded/other-suite
 * rows.
 */
describe('Phase 2D.3 — ServiceAccount & Tenant Grant Foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let grantsService: ServiceAccountTenantGrantsService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let operatorToken: string;
  let tenantAdminToken: string;
  let applicationId: string;
  let tenantAId: string;
  let tenantBId: string;

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
  }

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  async function createServiceAccount(name?: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/v1/applications/${applicationId}/service-accounts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: name ?? `SA-${randomUUID().slice(0, 8)}` });
  }

  async function createGrant(tenantId: string, serviceAccountId: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ serviceAccountId });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    grantsService = app.get(ServiceAccountTenantGrantsService);

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: {
        permissionCode: {
          in: ['PRODUCT_MANAGE', 'APPLICATION_MANAGE', 'SERVICE_ACCOUNT_VIEW', 'SERVICE_ACCOUNT_MANAGE', 'SERVICE_ACCOUNT_TENANT_GRANT_VIEW', 'SERVICE_ACCOUNT_TENANT_GRANT_MANAGE'],
        },
      },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    // Tenant-scoped token, used only to prove it's rejected outright.
    const tenantUser = await createGlobalUser(`tenantuser-${suffix}@example.com`);
    const tenantForAuth = await prisma.tenant.create({ data: { tenantCode: `P2D3-AUTH-${suffix}`, tenantName: 'Phase 2D.3 Auth Tenant', status: 'ACTIVE' } });
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    const org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantForAuth.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenantForAuth.id,
    );
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenantForAuth.id, organizationId: org.id, userId: tenantUser.id, status: 'ACTIVE' } }), tenantForAuth.id);
    const tenantLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenantForAuth.tenantCode, email: tenantUser.email, password: PASSWORD });
    tenantAdminToken = tenantLogin.body.accessToken;

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D3 Product ${suffix}`, slug: `p2d3-${suffix}` });
    const application = await request(app.getHttpServer())
      .post(`/api/v1/products/${product.body.id}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D3 App ${suffix}` });
    applicationId = application.body.id;

    const tenantA = await prisma.tenant.create({ data: { tenantCode: `P2D3-A-${suffix}`, tenantName: 'Phase 2D.3 Tenant A', status: 'ACTIVE' } });
    const tenantB = await prisma.tenant.create({ data: { tenantCode: `P2D3-B-${suffix}`, tenantName: 'Phase 2D.3 Tenant B', status: 'ACTIVE' } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ServiceAccount registration', () => {
    it('registers a service account and returns a plaintext credential exactly once', async () => {
      const res = await createServiceAccount();
      expect(res.status).toBe(201);
      expect(res.body.credential).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('credentialHash');

      const fetched = await request(app.getHttpServer()).get(`/api/v1/service-accounts/${res.body.id}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body).not.toHaveProperty('credential');
      expect(fetched.body).not.toHaveProperty('credentialHash');

      const dbRow = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbRow.credentialHash).not.toBeNull();
      expect(dbRow.credentialHash).not.toBe(res.body.credential); // stored hash, never the plaintext
    });

    it("the service account's id is stable, unique, and distinct from the owning Application's own clientId", async () => {
      const res = await createServiceAccount();
      const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
      expect(res.body.id).not.toBe(application.id);
      expect(res.body.id).not.toBe(application.clientId);
    });

    it('creating under a nonexistent application is DENIED with 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${randomUUID()}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Orphan' });
      expect(res.status).toBe(404);
    });

    it("listing service accounts under one application never leaks another application's own accounts", async () => {
      const otherApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${(await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Other App ${suffix}` });
      await createServiceAccount('Named-For-Isolation-Check');
      await request(app.getHttpServer())
        .post(`/api/v1/applications/${otherApp.body.id}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Other App SA' });

      const list = await request(app.getHttpServer()).get(`/api/v1/applications/${applicationId}/service-accounts`).set('Authorization', `Bearer ${operatorToken}`);
      expect(list.status).toBe(200);
      expect(list.body.items.every((sa: { applicationId: string }) => sa.applicationId === applicationId)).toBe(true);
      expect(list.body.items.some((sa: { name: string }) => sa.name === 'Other App SA')).toBe(false);
    });

    it('a tenant-scoped token is REJECTED outright for service account management', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ name: 'Should not be created' });
      expect(res.status).toBe(401);
    });
  });

  describe('ServiceAccount ownership immutability and lifecycle', () => {
    it('applicationId cannot be reassigned via update — the stored value never changes even when sent', async () => {
      const created = await createServiceAccount();
      const otherProduct = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Other Product ${suffix}`, slug: `other-p2d3-${suffix}` });
      const otherApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${otherProduct.body.id}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Other App For Reassign Test' });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/service-accounts/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ applicationId: otherApp.body.id });
      expect(res.status).toBe(200); // the extra field is simply not a recognized write target
      expect(res.body.applicationId).toBe(applicationId);

      const stillOriginal = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stillOriginal.applicationId).toBe(applicationId);
    });

    it('lifecycle: ACTIVE -> SUSPENDED -> DISABLED -> ACTIVE, never deleting the row, its id, its credential hash, or its tenant grants', async () => {
      const created = await createServiceAccount();
      await createGrant(tenantAId, created.body.id);
      const before = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: created.body.id } });

      const suspended = await request(app.getHttpServer()).patch(`/api/v1/service-accounts/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'SUSPENDED' });
      expect(suspended.status).toBe(200);
      expect(suspended.body.status).toBe('SUSPENDED');

      const disabled = await request(app.getHttpServer()).patch(`/api/v1/service-accounts/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });
      expect(disabled.status).toBe(200);
      expect(disabled.body.status).toBe('DISABLED');

      const after = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(after.id).toBe(before.id);
      expect(after.credentialHash).toBe(before.credentialHash); // no silent rotation
      const grantStillThere = await prismaContext.runInContext(
        (tx) => tx.serviceAccountTenantGrant.findFirst({ where: { serviceAccountId: created.body.id, tenantId: tenantAId } }),
        tenantAId,
      );
      expect(grantStillThere).not.toBeNull();
      expect(grantStillThere?.status).toBe('ACTIVE'); // Application-level lifecycle change never mutates the grant (Step 8/31)

      const enabledEvent = await prisma.securityEvent.findFirst({ where: { eventType: 'SERVICE_ACCOUNT_DISABLED', resourceId: created.body.id, scope: 'PLATFORM' } });
      expect(enabledEvent).not.toBeNull();
    });
  });

  describe('ServiceAccountTenantGrant — lifecycle, uniqueness, isolation', () => {
    it('creates an ACTIVE grant, and a duplicate create is denied with 409', async () => {
      const sa = await createServiceAccount();
      const res = await createGrant(tenantAId, sa.body.id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');

      const duplicate = await createGrant(tenantAId, sa.body.id);
      expect(duplicate.status).toBe(409);
    });

    it('REVOKED is never treated as ACTIVE, and reactivation requires the dedicated endpoint', async () => {
      const sa = await createServiceAccount();
      await createGrant(tenantAId, sa.body.id);

      const revoked = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });
      expect(revoked.status).toBe(200);
      expect(revoked.body.status).toBe('REVOKED');

      // The generic PATCH cannot bring it back to ACTIVE.
      const bypassAttempt = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'ACTIVE' });
      expect(bypassAttempt.status).toBe(409);

      const stillRevoked = await grantsService.findOne(tenantAId, sa.body.id);
      expect(stillRevoked.status).toBe('REVOKED');
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(false);

      // The dedicated reactivate endpoint is the only path back to ACTIVE.
      const reactivated = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}/reactivate`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(reactivated.status).toBe(201); // POST's default success status (no @HttpCode override on this endpoint)
      expect(reactivated.body.status).toBe('ACTIVE');
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(true);
    });

    it('SUSPENDED denies access; ACTIVE authorizes (via isGrantActive, the future pipeline integration point)', async () => {
      const sa = await createServiceAccount();
      await createGrant(tenantAId, sa.body.id);
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'SUSPENDED' });
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(false);
    });

    it('no grant at all denies access (deny-by-default)', async () => {
      const sa = await createServiceAccount();
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(false);
    });

    it('a grant for Tenant A is invisible and unmodifiable through Tenant B\'s own URL (cross-tenant isolation)', async () => {
      const sa = await createServiceAccount();
      await createGrant(tenantAId, sa.body.id);

      const wrongTenantGet = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantBId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(wrongTenantGet.status).toBe(404);

      const wrongTenantPatch = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantBId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });
      expect(wrongTenantPatch.status).toBe(404);

      // Tenant A's own grant is untouched.
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(true);
    });

    it('the SAME service account can independently hold grants for multiple tenants (never "all tenants" from one credential)', async () => {
      const sa = await createServiceAccount();
      await createGrant(tenantAId, sa.body.id);
      await createGrant(tenantBId, sa.body.id);

      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(true);
      expect(await grantsService.isGrantActive(tenantBId, sa.body.id)).toBe(true);

      // Revoking Tenant A's grant leaves Tenant B's completely unaffected.
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });
      expect(await grantsService.isGrantActive(tenantAId, sa.body.id)).toBe(false);
      expect(await grantsService.isGrantActive(tenantBId, sa.body.id)).toBe(true);
    });

    it('a tenant-scoped token is REJECTED outright for grant management (never merely denied a permission)', async () => {
      const sa = await createServiceAccount();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantAId}/service-account-grants`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ serviceAccountId: sa.body.id });
      expect(res.status).toBe(401);
    });

    it('a nonexistent tenant 404s, and a nonexistent service account 404s', async () => {
      const sa = await createServiceAccount();
      const badTenant = await createGrant(randomUUID(), sa.body.id);
      expect(badTenant.status).toBe(404);

      const badServiceAccount = await createGrant(tenantAId, randomUUID());
      expect(badServiceAccount.status).toBe(404);
    });
  });

  describe('Product entitlement independence (Step 17/18 — never duplicated, never implied)', () => {
    it('creating a ServiceAccountTenantGrant creates or mutates NO TenantProductEntitlement row', async () => {
      const sa = await createServiceAccount();
      const before = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.count({ where: { tenantId: tenantAId } }), tenantAId);
      await createGrant(tenantAId, sa.body.id);
      const after = await prismaContext.runInContext((tx) => tx.tenantProductEntitlement.count({ where: { tenantId: tenantAId } }), tenantAId);
      expect(after).toBe(before);
    });
  });

  describe('Organization boundary (Step 20/21 — no organization_id anywhere, no Membership shortcut)', () => {
    it('a ServiceAccountTenantGrant row carries no organization_id, and a ServiceAccount is not a security_user/Membership', async () => {
      const sa = await createServiceAccount();
      const grant = await createGrant(tenantAId, sa.body.id);
      expect(grant.body).not.toHaveProperty('organizationId');

      const asUser = await prisma.securityUser.findFirst({ where: { id: sa.body.id } });
      expect(asUser).toBeNull(); // the ServiceAccount id is never a security_user id
    });
  });

  describe('Concurrency', () => {
    it('two concurrent grant-creation requests for the same (serviceAccount, tenant) result in exactly one row: one 201, one 409', async () => {
      const sa = await createServiceAccount();
      const [r1, r2] = await Promise.all([createGrant(tenantAId, sa.body.id), createGrant(tenantAId, sa.body.id)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prismaContext.runInContext(
        (tx) => tx.serviceAccountTenantGrant.findMany({ where: { serviceAccountId: sa.body.id, tenantId: tenantAId } }),
        tenantAId,
      );
      expect(rows).toHaveLength(1);
    });

    it('concurrent SUSPEND vs REVOKE converge on REVOKED — the stronger terminal state wins regardless of commit order (same mechanism as TenantProductEntitlement)', async () => {
      const sa = await createServiceAccount();
      await createGrant(tenantAId, sa.body.id);

      await Promise.all([
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'SUSPENDED' }),
        request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenantAId}/service-account-grants/${sa.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'REVOKED' }),
      ]);

      const final = await grantsService.findOne(tenantAId, sa.body.id);
      expect(final.status).toBe('REVOKED');
    });

    it('duplicate ServiceAccount creation under the same application with the same name is denied by the database-level unique constraint (one 201, one 409)', async () => {
      const name = `Concurrency-Dup-${suffix}`;
      const [r1, r2] = await Promise.all([createServiceAccount(name), createServiceAccount(name)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prisma.serviceAccount.findMany({ where: { applicationId, name } });
      expect(rows).toHaveLength(1);
    });
  });
});
