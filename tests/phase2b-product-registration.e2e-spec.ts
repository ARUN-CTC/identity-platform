// See phase2a-membership.e2e-spec.ts's own comment — Test.createTestingModule
// never runs main.ts, so this polyfill has to be imported here too.
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
 * Phase 2B acceptance tests — Product/Application registration
 * (docs/PHASE_2B.md). Runs against the real identity_platform_db, same
 * pattern as tests/phase2a-membership.e2e-spec.ts.
 *
 * PHASE 2B.1 UPDATE (docs/PLATFORM_OPERATOR_ARCHITECTURE.md): Product/
 * Application administration now requires Platform Operator authentication
 * — a tenant-scoped SUPER_ADMIN token, however broad, is no longer
 * sufficient (see ADR-010). This suite was updated accordingly: the
 * "operator" fixture below logs in through /platform/auth/login, not
 * /auth/login, and every "TENANT_ADMIN denied" case now expects 401 (the
 * token is rejected outright by PlatformJwtAuthGuard) rather than 403 (a
 * tenant-permission check that no longer runs on these routes at all) —
 * itself the explicit regression proof this migration needed
 * (tests/phase2b1-platform-operator.e2e-spec.ts has the same proof from
 * the other direction). Every fixture uses a random suffix so repeated
 * runs never collide with the seeded TravelOS/Healthcare/Gym rows or with
 * each other.
 */
describe('Phase 2B — Product/Application Registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenant: { id: string; tenantCode: string };
  let org: { id: string };
  let operatorToken: string;
  let tenantAdminToken: string;

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
  }

  async function tenantLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
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

    tenant = await prisma.tenant.create({ data: { tenantCode: `P2B-${suffix}`, tenantName: 'Phase 2B Tenant', status: 'ACTIVE' } });
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenant.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenant.id,
    );

    const tenantAdminRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'TENANT_ADMIN', tenantId: null } });

    // Platform Operator fixture — holds every permission these tests need.
    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: { permissionCode: { in: ['PRODUCT_VIEW', 'PRODUCT_MANAGE', 'APPLICATION_VIEW', 'APPLICATION_MANAGE'] } },
    });
    await prisma.platformOperatorPermission.createMany({
      data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })),
    });
    operatorToken = await platformLogin(operatorUser.email);

    // Tenant fixture — a real tenant-scoped SUPER_ADMIN-equivalent, used
    // only to prove it is now REJECTED by these platform-guarded routes.
    const tenantAdminUser = await createGlobalUser(`tadmin-${suffix}@example.com`);
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenant.id, organizationId: org.id, userId: tenantAdminUser.id, status: 'ACTIVE' } }), tenant.id);
    await prismaContext.runInContext((tx) => tx.securityUserRole.create({ data: { tenantId: tenant.id, userId: tenantAdminUser.id, roleId: tenantAdminRole.id } }), tenant.id);
    tenantAdminToken = await tenantLogin(tenantAdminUser.email);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Product', () => {
    it('a Platform Operator can create a product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Widgets ${suffix}`, slug: `widgets-${suffix}`, description: 'A test product' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(`widgets-${suffix}`);
      expect(res.body).not.toHaveProperty('tenantId');
    });

    it('a duplicate slug is DENIED with 409, and uniqueness is case-insensitive at the database level', async () => {
      const exact = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Dup', slug: `widgets-${suffix}` });
      expect(exact.status).toBe(409);

      // CreateProductDto's own validator only accepts lowercase slugs, so
      // case-insensitivity can't be exercised through the HTTP API — it's
      // a database-level guarantee (uk_product_slug ON product(LOWER(slug)),
      // database/ddl/005_product.sql), verified directly against the DDL's
      // own constraint instead: a differently-cased duplicate insert must
      // violate it.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO product (name, slug) VALUES ('Case Clash', '${`WIDGETS-${suffix}`.toUpperCase()}')`,
        ),
      ).rejects.toThrow();
    });

    it('a tenant-scoped token (however broad) is REJECTED outright — Platform Operator authentication is required', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ name: 'Nope', slug: `nope-${suffix}` });
      expect(res.status).toBe(401);
    });

    it('an unauthenticated request is DENIED', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/products').send({ name: 'Nope', slug: `nope2-${suffix}` });
      expect(res.status).toBe(401);
    });

    it('a DISABLED product persists its status and remains readable (no request-time enforcement built in Phase 2B — see docs/PHASE_2B.md)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Disableable ${suffix}`, slug: `disableable-${suffix}` });

      const disabled = await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'DISABLED' });
      expect(disabled.status).toBe(200);
      expect(disabled.body.status).toBe('DISABLED');

      const read = await request(app.getHttpServer()).get(`/api/v1/products/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(read.status).toBe(200);
      expect(read.body.status).toBe('DISABLED');

      // Phase 2B.1: this event is scope='PLATFORM', tenantId genuinely
      // NULL — unconditionally visible through RLS, no GUC needed (see
      // database/ddl/006_platform_operator.sql).
      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'PRODUCT_DISABLED', resourceId: created.body.id, scope: 'PLATFORM' } });
      expect(event).not.toBeNull();
      expect(event?.tenantId).toBeNull();
    });
  });

  describe('Application', () => {
    let productId: string;

    beforeAll(async () => {
      const product = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `App Host ${suffix}`, slug: `app-host-${suffix}` });
      productId = product.body.id;
    });

    it('a Platform Operator can create a CONFIDENTIAL application and receives clientSecret exactly once', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Web' });
      expect(res.status).toBe(201);
      expect(res.body.clientSecret).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('clientSecretHash');

      const fetched = await request(app.getHttpServer()).get(`/api/v1/applications/${res.body.id}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body).not.toHaveProperty('clientSecret');
      expect(fetched.body).not.toHaveProperty('clientSecretHash');

      const dbRow = await prisma.application.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbRow.clientSecretHash).not.toBeNull();
      expect(dbRow.clientSecretHash).not.toBe(res.body.clientSecret); // stored hash, never the plaintext
    });

    it('a PUBLIC application receives no client secret at all', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'SPA', clientType: 'PUBLIC' });
      expect(res.status).toBe(201);
      expect(res.body.clientSecret).toBeNull();
    });

    it('creating an application under a nonexistent product is DENIED with 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${randomUUID()}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Orphan' });
      expect(res.status).toBe(404);
    });

    it('listing applications under one product never leaks another product\'s applications (cross-product isolation)', async () => {
      const otherProduct = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Other ${suffix}`, slug: `other-${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/products/${otherProduct.body.id}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Other App' });

      const list = await request(app.getHttpServer()).get(`/api/v1/products/${productId}/applications`).set('Authorization', `Bearer ${operatorToken}`);
      expect(list.status).toBe(200);
      expect(list.body.items.every((a: { productId: string }) => a.productId === productId)).toBe(true);
      expect(list.body.items.some((a: { name: string }) => a.name === 'Other App')).toBe(false);
    });

    it('a tenant-scoped token is REJECTED outright for application management too', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ name: 'Should not be created' });
      expect(res.status).toBe(401);
    });

    it('disabling an application persists status and is itself audited', async () => {
      const created = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Disableable App' });

      const disabled = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'DISABLED' });
      expect(disabled.status).toBe(200);
      expect(disabled.body.status).toBe('DISABLED');

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'APPLICATION_DISABLED', resourceId: created.body.id, scope: 'PLATFORM' } });
      expect(event).not.toBeNull();
    });
  });

  describe('Security — IDOR / unauthorized administration', () => {
    it('an unauthenticated caller cannot read products or applications', async () => {
      const products = await request(app.getHttpServer()).get('/api/v1/products');
      expect(products.status).toBe(401);
      const applications = await request(app.getHttpServer()).get(`/api/v1/applications/${randomUUID()}`);
      expect(applications.status).toBe(401);
    });

    it('a well-formed but nonexistent application id 404s rather than erroring (no IDOR information leak)', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/applications/${randomUUID()}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(404);
    });

    it('a tenant-scoped token cannot update an application\'s status even by guessing a valid id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `IDOR Target ${suffix}`, slug: `idor-target-${suffix}` });
      const app_ = await request(app.getHttpServer())
        .post(`/api/v1/products/${created.body.id}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Target App' });

      const tamperAttempt = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${app_.body.id}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ status: 'DISABLED' });
      expect(tamperAttempt.status).toBe(401);

      const stillActive = await prisma.application.findUniqueOrThrow({ where: { id: app_.body.id } });
      expect(stillActive.status).toBe('ACTIVE');
    });
  });
});
