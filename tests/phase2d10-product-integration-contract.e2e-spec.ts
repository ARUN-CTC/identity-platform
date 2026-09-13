import '../src/common/bigint-json.polyfill';

import type { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaService } from '../src/database';
import { JwksClientService } from '../src/modules/resource-server/services';
import { ResourceAuthorizationPolicyRegistry } from '../src/modules/resource-server/authorization';
import { DEMO_PRODUCT_CONTRACT } from '../src/modules/resource-server/controllers/resource-server-demo.controller';
import { ProductAccessService } from '../src/modules/product-entitlements/services';
import {
  IDENTITY_BEARER_ERROR_HTTP_STATUS,
  IdentityAuthorizationContext,
  IdentityAuthorizationPolicy,
  IdentityAuthorizationRequest,
  IdentityAuthorizationResult,
  identityAuthorizationDenied,
} from '../src/contracts';

/**
 * Phase 2D.10 acceptance tests — External Product Integration Contract
 * (docs/PRODUCT_INTEGRATION_CONTRACT.md, docs/IDENTITY_EXTERNAL_API_CONTRACT.md).
 *
 * Distinct from `tests/phase2d6-resource-authorization.e2e-spec.ts` (which
 * already proves the full Layer 1-7 pipeline against the INTERNAL type
 * names): everything below is typed EXCLUSIVELY against the `src/contracts`
 * facade (`IdentityAuthorizationPolicy`/`IdentityAuthorizationContext`/
 * `IdentityAuthorizationRequest`/`IdentityAuthorizationResult`), proving
 * that facade alone is sufficient for a hypothetical product to implement
 * its own authorization decision — and closes two entitlement-state gaps
 * Phase 2D.6 did not exercise: entitlement REVOKED and product DISABLED.
 */
describe('Phase 2D.10 — Product Integration Contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwksClient: JwksClientService;
  let registry: ResourceAuthorizationPolicyRegistry;
  let productAccess: ProductAccessService;

  const suffix = randomUUID().slice(0, 8);
  const DEMO_AUDIENCE = 'resource-server-demo-api';

  let operatorToken: string;
  let issuanceProductId: string; // entitlement required merely to obtain a token at all (Phase 2D.4 issuance-time eligibility)
  let checkedProductId: string; // the product THIS SUITE's contract-facade policy actually checks (Layer 4) — independent of issuanceProductId, same separation Phase 2D.6 established
  let disabledProductId: string;
  let applicationId: string;
  let clientId: string;
  let clientSecret: string;
  let serviceAccountId: string;
  let serviceAccountSecret: string;

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: 'Test-Passw0rd!1' });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  async function issueToken(tenantId: string, scope = 'openid'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`)
      .send({ grant_type: 'client_credentials', service_account_id: serviceAccountId, service_account_secret: serviceAccountSecret, tenant_id: tenantId, audience: DEMO_AUDIENCE, ...(scope ? { scope } : {}) });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  function callContractDemo(token: string) {
    return request(app.getHttpServer()).get('/api/v1/resource-server/demo/authorized/contract-demo').set('Authorization', `Bearer ${token}`);
  }

  async function makeTenantEntitledTo(label: string, productId: string | undefined, entitlementStatus?: 'SUSPENDED' | 'REVOKED'): Promise<string> {
    const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D10-${label}-${suffix}`, tenantName: `P2D10 ${label}`, status: 'ACTIVE' } });
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/service-account-grants`).set('Authorization', `Bearer ${operatorToken}`).send({ serviceAccountId });
    // Required for issuance itself, regardless of what this test is about.
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId: issuanceProductId });
    if (productId) {
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId });
      if (entitlementStatus) {
        await request(app.getHttpServer()).patch(`/api/v1/platform/tenants/${tenant.id}/product-entitlements/${productId}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: entitlementStatus });
      }
    }
    return tenant.id;
  }

  /**
   * The reference/example product policy — authored using ONLY the
   * `src/contracts` facade types. Composes: Layer 4 (entitlement, via the
   * real `ProductAccessService` this platform ships) + Layer 6 (a made-up
   * IAM allow-list, entirely local to this test) + Layer 7 (resource/action
   * recognition). Never imports `ResourceAuthorizationContext`/
   * `AuthorizationDecision`/`ResourceAuthorizationPolicy` from their
   * internal `resource-server/...` paths.
   */
  function makeContractPolicy(): IdentityAuthorizationPolicy {
    return {
      async authorize(context: IdentityAuthorizationContext, req: IdentityAuthorizationRequest): Promise<IdentityAuthorizationResult> {
        if (req.resource !== 'contract-resource' || req.action !== 'read') {
          return identityAuthorizationDenied('unknown_resource_or_action');
        }
        const access = await productAccess.canAccess(context.tenantId, checkedProductId);
        if (!access.allowed) {
          return identityAuthorizationDenied(access.reason ?? 'not_entitled');
        }
        return { allowed: true };
      },
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    prisma = app.get(PrismaService);
    jwksClient = app.get(JwksClientService);
    registry = app.get(ResourceAuthorizationPolicyRegistry);
    productAccess = app.get(ProductAccessService);
    jwksClient.configureJwksUri(`http://127.0.0.1:${address.port}/.well-known/jwks.json`);

    registry.register(DEMO_PRODUCT_CONTRACT, makeContractPolicy());

    const operatorUser = await prisma.securityUser.create({
      data: { email: `p2d10-operator-${suffix}@example.com`, firstName: 'Test', lastName: 'Operator', status: 'ACTIVE', passwordHash: await hashPassword('Test-Passw0rd!1'), passwordChangedAt: new Date() },
    });
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: { permissionCode: { in: ['PRODUCT_MANAGE', 'APPLICATION_MANAGE', 'SERVICE_ACCOUNT_MANAGE', 'SERVICE_ACCOUNT_TENANT_GRANT_MANAGE', 'PRODUCT_ENTITLEMENT_MANAGE'] } },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    const product = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D10 Issuance ${suffix}`, slug: `p2d10-iss-${suffix}` });
    issuanceProductId = product.body.id;

    const checkedProduct = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D10 Checked ${suffix}`, slug: `p2d10-chk-${suffix}` });
    checkedProductId = checkedProduct.body.id;

    const application = await request(app.getHttpServer())
      .post(`/api/v1/products/${issuanceProductId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D10 App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: ['openid'], audiences: [DEMO_AUDIENCE] });
    applicationId = application.body.id;
    clientId = application.body.clientId;
    clientSecret = application.body.clientSecret;

    const serviceAccount = await request(app.getHttpServer()).post(`/api/v1/applications/${applicationId}/service-accounts`).set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D10 SA ${suffix}` });
    serviceAccountId = serviceAccount.body.id;
    serviceAccountSecret = serviceAccount.body.credential;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Full chain, authored only against the src/contracts facade', () => {
    it('ACTIVE entitlement -> 200, and the response principal shape matches the documented external contract', async () => {
      const tenantId = await makeTenantEntitledTo('Active', checkedProductId);
      const token = await issueToken(tenantId);
      const res = await callContractDemo(token);
      expect(res.status).toBe(200);
      expect(res.body.principal).toMatchObject({ tenantId, clientId, audience: DEMO_AUDIENCE });
      expect(res.body.principal.serviceAccountId).toBe(serviceAccountId);
      expect(typeof res.body.principal.jti).toBe('string');
    });

    it('no entitlement row at all -> 403, generic "forbidden" (no entitlement-existence enumeration)', async () => {
      const tenantId = await makeTenantEntitledTo('NoEnt', undefined);
      const token = await issueToken(tenantId);
      const res = await callContractDemo(token);
      expect(res.status).toBe(IDENTITY_BEARER_ERROR_HTTP_STATUS.forbidden);
      expect(res.body.error).toBe('forbidden');
      expect(res.body.error_description).not.toMatch(/entitlement|NO_ENTITLEMENT/i);
    });

    it('SUSPENDED entitlement -> 403, indistinguishable from "no entitlement" externally', async () => {
      const tenantId = await makeTenantEntitledTo('Susp', checkedProductId, 'SUSPENDED');
      const token = await issueToken(tenantId);
      const res = await callContractDemo(token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });

    it('REVOKED entitlement -> 403 (a gap Phase 2D.6 did not exercise)', async () => {
      const tenantId = await makeTenantEntitledTo('Revoked', checkedProductId, 'REVOKED');
      const token = await issueToken(tenantId);
      const res = await callContractDemo(token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });

    it('product itself DISABLED -> 403, even for a tenant with an otherwise-ACTIVE entitlement row (a gap Phase 2D.6 did not exercise)', async () => {
      const disabled = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D10 Disabled ${suffix}`, slug: `p2d10-dis-${suffix}` });
      disabledProductId = disabled.body.id;
      const tenantId = await makeTenantEntitledTo('Dis', disabledProductId);
      await request(app.getHttpServer()).patch(`/api/v1/products/${disabledProductId}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });

      // Swap the checked product just for this one assertion (registry policy closes over the module-scoped `checkedProductId`).
      const previousCheckedProductId = checkedProductId;
      checkedProductId = disabledProductId;
      try {
        const token = await issueToken(tenantId);
        const res = await callContractDemo(token);
        expect(res.status).toBe(403);
      } finally {
        checkedProductId = previousCheckedProductId;
      }
    });

    it('missing required scope -> 403 insufficient_scope, enforced before the contract policy is ever consulted', async () => {
      const tenantId = await makeTenantEntitledTo('NoScope', checkedProductId);
      const token = await issueToken(tenantId, '');
      const res = await callContractDemo(token);
      expect(res.status).toBe(IDENTITY_BEARER_ERROR_HTTP_STATUS.insufficient_scope);
      expect(res.body.error).toBe('insufficient_scope');
    });

    it('an expired/garbage bearer token -> 401 invalid_token, never 403 (401 vs 403 contract preserved)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/authorized/contract-demo').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(IDENTITY_BEARER_ERROR_HTTP_STATUS.invalid_token);
      expect(res.body.error).toBe('invalid_token');
    });
  });
});
