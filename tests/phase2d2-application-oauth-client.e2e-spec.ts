import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { OAuthApplicationPolicyService } from '../src/modules/applications/policies';

/**
 * Phase 2D.2 acceptance tests — Application / OAuth Client Foundation
 * (docs/PHASE_2D2.md, docs/adr/ADR-018-application-trust-client-types.md).
 * Deliberately additive to, not a restatement of,
 * tests/phase2b-product-registration.e2e-spec.ts — that suite already
 * covers secret handling, product-boundary isolation, and IDOR/platform-
 * operator-vs-tenant-token rejection thoroughly; this suite covers what is
 * new in this phase: grant-type/scope/audience/redirect-URI/origin policy
 * enforcement, tokenEndpointAuthMethod derivation, and the composed
 * OAuthApplicationPolicyService eligibility check. Runs against the real
 * identity_platform_db.
 */
describe('Phase 2D.2 — Application / OAuth Client Foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let eligibilityPolicy: OAuthApplicationPolicyService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let operatorToken: string;
  let tenantAdminToken: string;
  let productId: string;
  let productSlug: string;

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

  async function createApplication(body: Record<string, unknown>): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `App-${randomUUID().slice(0, 8)}`, ...body });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    eligibilityPolicy = app.get(OAuthApplicationPolicyService);

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({ where: { permissionCode: { in: ['PRODUCT_MANAGE', 'APPLICATION_MANAGE', 'APPLICATION_VIEW'] } } });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    // A tenant-scoped token, used only to prove it's rejected outright (same as phase2b's own suite).
    const tenantUser = await createGlobalUser(`tenantuser-${suffix}@example.com`);
    const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D2-${suffix}`, tenantName: 'Phase 2D.2 Tenant', status: 'ACTIVE' } });
    const orgType = await prisma.organizationType.findFirstOrThrow({ where: { typeCode: 'DEFAULT' } });
    const org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenant.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenant.id,
    );
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenant.id, organizationId: org.id, userId: tenantUser.id, status: 'ACTIVE' } }), tenant.id);
    const tenantLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: tenantUser.email, password: PASSWORD });
    tenantAdminToken = tenantLogin.body.accessToken;

    productSlug = `p2d2-${suffix}`;
    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `Phase 2D.2 Product ${suffix}`, slug: productSlug });
    productId = product.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Registration — valid configurations', () => {
    it('registers a CONFIDENTIAL application with grantTypes/allowedScopes/audiences/redirectUris, deriving tokenEndpointAuthMethod', async () => {
      const res = await createApplication({
        clientType: 'CONFIDENTIAL',
        grantTypes: ['authorization_code', 'client_credentials'],
        allowedScopes: [`${productSlug}.read`, `${productSlug}.write`, 'openid'],
        audiences: [`${productSlug}-api`],
        redirectUris: ['https://app.example.com/callback'],
      });
      expect(res.status).toBe(201);
      expect(res.body.tokenEndpointAuthMethod).toBe('client_secret_basic');
      expect(res.body.grantTypes).toEqual(['authorization_code', 'client_credentials']);
      expect(res.body.clientSecret).toEqual(expect.any(String));
    });

    it('registers a PUBLIC application, deriving tokenEndpointAuthMethod = none, without client_credentials', async () => {
      const res = await createApplication({
        clientType: 'PUBLIC',
        grantTypes: ['authorization_code'],
        redirectUris: ['com.example.app://callback'],
      });
      expect(res.status).toBe(201);
      expect(res.body.tokenEndpointAuthMethod).toBe('none');
      expect(res.body.clientSecret).toBeNull();
    });

    it('tokenEndpointAuthMethod cannot be set to a mismatched value via request input — the server-derived value always wins', async () => {
      // NOTE: the global ValidationPipe's `forbidNonWhitelisted` (main.ts)
      // is not wired into this TestingModule-based harness (a pre-existing
      // gap shared by every e2e suite in this repo, not introduced here) —
      // so an extra field isn't rejected at the HTTP layer in this test
      // environment. The actual security property this test proves is
      // stronger and harness-independent: even when the field IS accepted
      // as input, ApplicationsService never reads it — tokenEndpointAuthMethod
      // is always ApplicationsService's own derivation from clientType
      // (ADR-018), never the attacker-supplied value.
      const res = await createApplication({ clientType: 'CONFIDENTIAL', tokenEndpointAuthMethod: 'none' });
      expect(res.status).toBe(201);
      expect(res.body.tokenEndpointAuthMethod).toBe('client_secret_basic');

      const dbRow = await prisma.application.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbRow.tokenEndpointAuthMethod).toBe('client_secret_basic');
    });

    it('an empty grantTypes/allowedScopes/audiences/redirectUris configuration is accepted (deny-by-default, nothing configured yet)', async () => {
      const res = await createApplication({});
      expect(res.status).toBe(201);
      expect(res.body.grantTypes).toEqual([]);
      expect(res.body.allowedScopes).toEqual([]);
      expect(res.body.audiences).toEqual([]);
    });
  });

  describe('Registration — grant-type validation', () => {
    it('DENY: an unsupported grant type', async () => {
      const res = await createApplication({ grantTypes: ['implicit'] });
      expect(res.status).toBe(400);
    });

    it('DENY: password grant', async () => {
      const res = await createApplication({ grantTypes: ['password'] });
      expect(res.status).toBe(400);
    });

    it('DENY: a PUBLIC client configured for client_credentials', async () => {
      const res = await createApplication({ clientType: 'PUBLIC', grantTypes: ['client_credentials'] });
      expect(res.status).toBe(400);
    });

    it('DENY: authorization_code without any registered redirect URI', async () => {
      const res = await createApplication({ grantTypes: ['authorization_code'], redirectUris: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('Registration — scope validation', () => {
    it('PASS: scopes namespaced under the owning product, and standard OIDC scopes', async () => {
      const res = await createApplication({ allowedScopes: [`${productSlug}.read`, 'openid', 'profile', 'email'] });
      expect(res.status).toBe(201);
    });

    it("DENY: a scope namespaced under a DIFFERENT product", async () => {
      const res = await createApplication({ allowedScopes: ['some-other-product.read'] });
      expect(res.status).toBe(400);
    });

    it('DENY: an un-namespaced, non-standard scope', async () => {
      const res = await createApplication({ allowedScopes: ['read'] });
      expect(res.status).toBe(400);
    });
  });

  describe('Registration — audience validation', () => {
    it('PASS: a normal audience', async () => {
      const res = await createApplication({ audiences: [`${productSlug}-api`] });
      expect(res.status).toBe(201);
    });

    it("DENY: wildcard audience '*'", async () => {
      const res = await createApplication({ audiences: ['*'] });
      expect(res.status).toBe(400);
    });

    it("DENY: implicit-all audience values ('all'/'any')", async () => {
      expect((await createApplication({ audiences: ['all'] })).status).toBe(400);
      expect((await createApplication({ audiences: ['any'] })).status).toBe(400);
    });
  });

  describe('Registration — redirect URI validation (attack matrix)', () => {
    it('PASS: exact, well-formed HTTPS redirect URI', async () => {
      const res = await createApplication({ redirectUris: ['https://app.example.com/callback'] });
      expect(res.status).toBe(201);
    });

    it('PASS: localhost HTTP for development', async () => {
      const res = await createApplication({ redirectUris: ['http://localhost:5173/callback'] });
      expect(res.status).toBe(201);
    });

    it('DENY: production HTTP (non-loopback)', async () => {
      const res = await createApplication({ redirectUris: ['http://app.example.com/callback'] });
      expect(res.status).toBe(400);
    });

    it('DENY: wildcard redirect URI', async () => {
      const res = await createApplication({ redirectUris: ['https://*.example.com/callback'] });
      expect(res.status).toBe(400);
    });

    it('DENY: fragment in redirect URI', async () => {
      const res = await createApplication({ redirectUris: ['https://app.example.com/callback#token'] });
      expect(res.status).toBe(400);
    });

    it('DENY: malformed/relative URI', async () => {
      const res = await createApplication({ redirectUris: ['/callback'] });
      expect(res.status).toBe(400);
    });

    it('PASS: a custom mobile scheme', async () => {
      const res = await createApplication({ redirectUris: ['com.example.app://callback'] });
      expect(res.status).toBe(201);
    });
  });

  describe('Registration — origin validation', () => {
    it('PASS: a well-formed HTTPS origin', async () => {
      const res = await createApplication({ allowedOrigins: ['https://app.example.com'] });
      expect(res.status).toBe(201);
    });

    it("DENY: wildcard origin '*'", async () => {
      const res = await createApplication({ allowedOrigins: ['*'] });
      expect(res.status).toBe(400);
    });
  });

  describe('Update — re-validation and immutability', () => {
    it('re-validates grantTypes on update, denying an invalid change', async () => {
      const created = await createApplication({ grantTypes: ['authorization_code'], redirectUris: ['https://app.example.com/callback'] });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ grantTypes: ['implicit'] });
      expect(res.status).toBe(400);
    });

    it('allows a valid grantTypes/allowedScopes update', async () => {
      const created = await createApplication({});
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ grantTypes: ['client_credentials'], allowedScopes: [`${productSlug}.sync`] });
      expect(res.status).toBe(200);
      expect(res.body.grantTypes).toEqual(['client_credentials']);
    });

    it('productId cannot be reassigned via update — UpdateApplicationDto has no such field, so ApplicationsRepository.update() never writes one even if sent', async () => {
      // Same harness caveat as the tokenEndpointAuthMethod test above: this
      // asserts the actual, harness-independent invariant (the stored
      // productId never changes) rather than assuming the (here-unwired)
      // global ValidationPipe rejects the extra field at the HTTP layer.
      const created = await createApplication({});
      const otherProduct = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `Other Product ${suffix}`, slug: `other-p2d2-${suffix}` });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId: otherProduct.body.id });
      expect(res.status).toBe(200);
      expect(res.body.productId).toBe(productId); // unchanged despite the attempt

      const stillOriginal = await prisma.application.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stillOriginal.productId).toBe(productId);
    });

    it('a tenant-scoped token cannot update grantTypes/allowedScopes/audiences either (rejected outright, same as every other Application field)', async () => {
      const created = await createApplication({});
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/applications/${created.body.id}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ grantTypes: ['client_credentials'] });
      expect(res.status).toBe(401);
    });
  });

  describe('Response never leaks secret material', () => {
    it('create/get/list/update responses never contain clientSecretHash, and only create ever contains clientSecret', async () => {
      const created = await createApplication({});
      expect(created.body).not.toHaveProperty('clientSecretHash');

      const fetched = await request(app.getHttpServer()).get(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(fetched.body).not.toHaveProperty('clientSecretHash');
      expect(fetched.body).not.toHaveProperty('clientSecret');

      const list = await request(app.getHttpServer()).get(`/api/v1/products/${productId}/applications`).set('Authorization', `Bearer ${operatorToken}`);
      for (const item of list.body.items) {
        expect(item).not.toHaveProperty('clientSecretHash');
        expect(item).not.toHaveProperty('clientSecret');
      }

      const updated = await request(app.getHttpServer()).patch(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ name: 'Renamed' });
      expect(updated.body).not.toHaveProperty('clientSecretHash');
      expect(updated.body).not.toHaveProperty('clientSecret');
    });
  });

  describe('Lifecycle + OAuthApplicationPolicyService eligibility (composed facade, no token issued)', () => {
    it('ACTIVE is eligible; DISABLED/SUSPENDED are not — verified through the SAME composed policy a future /token would call', async () => {
      const created = await createApplication({ grantTypes: ['client_credentials'] });
      const clientId = (await prisma.application.findUniqueOrThrow({ where: { id: created.body.id } })).clientId;

      await expect(eligibilityPolicy.checkEligibility({ clientId, grantType: 'client_credentials' })).resolves.toBeDefined();

      await request(app.getHttpServer()).patch(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });
      await expect(eligibilityPolicy.checkEligibility({ clientId, grantType: 'client_credentials' })).rejects.toMatchObject({ reason: 'application_inactive' });

      await request(app.getHttpServer()).patch(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'SUSPENDED' });
      await expect(eligibilityPolicy.checkEligibility({ clientId, grantType: 'client_credentials' })).rejects.toMatchObject({ reason: 'application_inactive' });

      await request(app.getHttpServer()).patch(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'ACTIVE' });
      await expect(eligibilityPolicy.checkEligibility({ clientId, grantType: 'client_credentials' })).resolves.toBeDefined();
    });

    it('disabling an Application does not delete it, its client_id, its history, or mutate anything beyond status', async () => {
      const created = await createApplication({ grantTypes: ['authorization_code'], redirectUris: ['https://app.example.com/callback'] });
      const before = await prisma.application.findUniqueOrThrow({ where: { id: created.body.id } });

      await request(app.getHttpServer()).patch(`/api/v1/applications/${created.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });

      const after = await prisma.application.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(after.id).toBe(before.id);
      expect(after.clientId).toBe(before.clientId);
      expect(after.clientSecretHash).toBe(before.clientSecretHash); // no silent rotation
      expect(after.grantTypes).toEqual(before.grantTypes);
      expect(after.status).toBe('DISABLED');

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'APPLICATION_DISABLED', resourceId: created.body.id, scope: 'PLATFORM' } });
      expect(event).not.toBeNull();
    });
  });

  describe('Tenant boundary — Application configuration never creates tenant authorization', () => {
    it('an Application row carries no tenant_id/organization_id — configuring it grants no tenant access by construction', async () => {
      const created = await createApplication({ grantTypes: ['client_credentials'], audiences: [`${productSlug}-api`] });
      expect(created.body).not.toHaveProperty('tenantId');
      expect(created.body).not.toHaveProperty('organizationId');
      const dbRow = await prisma.application.findUniqueOrThrow({ where: { id: created.body.id } });
      expect((dbRow as unknown as Record<string, unknown>).tenantId).toBeUndefined();
    });
  });
});
