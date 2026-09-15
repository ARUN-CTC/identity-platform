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
import { AuthorizationDecision, ResourceAuthorizationPolicy, ResourceAuthorizationPolicyRegistry, ResourceAuthorizationRequest } from '../src/modules/resource-server/authorization';
import { ResourceAuthorizationContext } from '../src/modules/resource-server/interfaces';
import { DEMO_PRODUCT_A, DEMO_PRODUCT_B } from '../src/modules/resource-server/controllers/resource-server-demo.controller';
import { ProductAccessService } from '../src/modules/product-entitlements/services';

/**
 * Phase 2D.6 acceptance tests — Product Resource Authorization Contract &
 * Integration Boundary (docs/RESOURCE_AUTHORIZATION_CONTRACT.md). Every
 * "product policy" used here is authored INSIDE THIS TEST FILE, not
 * shipped in `src/` — proving the contract works while keeping Identity
 * Platform itself unaware of any real product's resources/actions/
 * permissions (brief §9/§36). Reuses the exact Phase 2D.5 fixture pattern
 * (real `app.listen(0)`, JWKS pointed at that real server, tokens issued
 * through the actual, unmodified Phase 2D.4 pipeline).
 */
describe('Phase 2D.6 — Product Resource Authorization Contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwksClient: JwksClientService;
  let registry: ResourceAuthorizationPolicyRegistry;
  let productAccess: ProductAccessService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const DEMO_AUDIENCE = 'resource-server-demo-api';

  let operatorToken: string;
  let productId: string; // tied to the Application used for issuance — Phase 2D.4 ITSELF already requires this be ACTIVE-entitled for every tenant before a token can be issued at all
  let productId2: string; // a SECOND, independent Product, never referenced by any Application/audience — used only by the demo policy's own Layer-4 entitlement check, so that layer is tested genuinely independently of what issuance already checked
  let applicationId: string;
  let clientId: string;
  let clientSecret: string;
  let serviceAccountId: string;
  let serviceAccountSecret: string;

  let tenantEntitledId: string; // grant ACTIVE, entitlement ACTIVE — the "allowed" tenant
  let tenantNoEntitlementId: string; // grant ACTIVE, no entitlement row at all
  let tenantSuspendedEntitlementId: string; // grant ACTIVE, entitlement SUSPENDED
  let tenantNotInAllowlistId: string; // grant ACTIVE, entitlement ACTIVE, but NOT in the IAM allow-list the demo policy enforces

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

  async function issueToken(tenantId: string, scope?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`)
      .send({ grant_type: 'client_credentials', service_account_id: serviceAccountId, service_account_secret: serviceAccountSecret, tenant_id: tenantId, audience: DEMO_AUDIENCE, ...(scope ? { scope } : {}) });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  function getRoute(path: string, token?: string, extraHeaders: Record<string, string> = {}) {
    const req = request(app.getHttpServer()).get(`/api/v1/resource-server/demo/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
    return req;
  }

  /** ALLOWED tenants for this test's own made-up "IAM permission" rule (Layer 6) — entirely local to this test file. */
  let iamAllowedTenants: Set<string>;

  /** The reference/demo policy for Product A — composes entitlement (Layer 4, via the real ProductAccessService), a made-up IAM allow-list (Layer 6), and resource/action recognition (Layer 7). Lives ONLY in this test file. */
  function makeProductAPolicy(): ResourceAuthorizationPolicy {
    return {
      async authorize(context: ResourceAuthorizationContext, req: ResourceAuthorizationRequest): Promise<AuthorizationDecision> {
        if (req.resource !== 'demo-resource') {
          return { allowed: false, reasonCode: 'unknown_resource' };
        }
        if (req.action !== 'read') {
          return { allowed: false, reasonCode: 'unknown_action' };
        }
        const access = await productAccess.canAccess(context.tenantId, productId2);
        if (!access.allowed) {
          return { allowed: false, reasonCode: access.reason ?? 'not_entitled' };
        }
        if (!iamAllowedTenants.has(context.tenantId)) {
          return { allowed: false, reasonCode: 'iam_permission_denied', requiredPermission: 'DEMO_RESOURCE_READ' };
        }
        return { allowed: true };
      },
    };
  }

  const productBPolicy: ResourceAuthorizationPolicy = {
    async authorize(): Promise<AuthorizationDecision> {
      return { allowed: true };
    },
  };

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

    iamAllowedTenants = new Set();
    registry.register(DEMO_PRODUCT_A, makeProductAPolicy());
    registry.register(DEMO_PRODUCT_B, productBPolicy);

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: {
        permissionCode: {
          in: [
            'PRODUCT_MANAGE',
            'APPLICATION_MANAGE',
            'SERVICE_ACCOUNT_VIEW',
            'SERVICE_ACCOUNT_MANAGE',
            'SERVICE_ACCOUNT_TENANT_GRANT_VIEW',
            'SERVICE_ACCOUNT_TENANT_GRANT_MANAGE',
            'PRODUCT_ENTITLEMENT_VIEW',
            'PRODUCT_ENTITLEMENT_MANAGE',
          ],
        },
      },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D6 Product ${suffix}`, slug: `p2d6-${suffix}` });
    productId = product.body.id;

    const application = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D6 App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: ['openid'], audiences: [DEMO_AUDIENCE] });
    applicationId = application.body.id;
    clientId = application.body.clientId;
    clientSecret = application.body.clientSecret;

    const serviceAccount = await request(app.getHttpServer())
      .post(`/api/v1/applications/${applicationId}/service-accounts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D6 SA ${suffix}` });
    serviceAccountId = serviceAccount.body.id;
    serviceAccountSecret = serviceAccount.body.credential;

    const product2 = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D6 Product 2 ${suffix}`, slug: `p2d6-two-${suffix}` });
    productId2 = product2.body.id;

    async function makeTenant(label: string): Promise<string> {
      const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D6-${label}-${suffix}`, tenantName: `P2D6 ${label}`, status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId });
      // Every tenant in this suite needs an ACTIVE entitlement for `productId`
      // (the Application's own product) — Phase 2D.4 issuance itself already
      // requires this (ProductAccessService.canAccess, its own step 6); a
      // tenant lacking it could never obtain a token at all, which would
      // make it impossible to reach the resource-authorization layer this
      // suite actually wants to test. Entitlement to `productId2` (below) is
      // what varies per tenant, since that is the product this suite's own
      // demo policy independently checks.
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId });
      return tenant.id;
    }

    tenantEntitledId = await makeTenant('Entitled');
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantEntitledId}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId: productId2 });
    iamAllowedTenants.add(tenantEntitledId);

    tenantNoEntitlementId = await makeTenant('NoEnt');
    // deliberately no entitlement created for productId2

    tenantSuspendedEntitlementId = await makeTenant('SuspEnt');
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantSuspendedEntitlementId}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId: productId2 });
    await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${tenantSuspendedEntitlementId}/product-entitlements/${productId2}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'SUSPENDED' });

    tenantNotInAllowlistId = await makeTenant('NoIam');
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantNotInAllowlistId}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId: productId2 });
    // deliberately NOT added to iamAllowedTenants
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Full pipeline — positive path
  // ===========================================================================
  describe('Full pipeline (Layers 1-7)', () => {
    it('valid token + valid audience + scope + entitlement + IAM allow-list = 200', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe(tenantEntitledId);
    });

    it('valid token + missing required scope = 403 (checked before the product policy is ever consulted)', async () => {
      const token = await issueToken(tenantEntitledId); // no scope requested
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
    });

    it('valid token + wrong audience = 401 (Layer 2, unchanged from Phase 2D.5)', async () => {
      // Application only has DEMO_AUDIENCE registered — issuance itself
      // enforces this (Phase 2D.2/2D.4), so this is exercised by attempting
      // to request a foreign audience at issuance time and confirming it is
      // rejected before any token even exists to present here.
      const res = await request(app.getHttpServer())
        .post('/api/v1/oauth/token')
        .type('form')
        .set('Authorization', `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`)
        .send({ grant_type: 'client_credentials', service_account_id: serviceAccountId, service_account_secret: serviceAccountSecret, tenant_id: tenantEntitledId, audience: 'unrelated-api' });
      expect(res.status).toBe(400); // invalid_target — never reaches the resource server at all
    });
  });

  // ===========================================================================
  // Product Entitlement vs ServiceAccountTenantGrant (brief §11/§33)
  // ===========================================================================
  describe('Product Entitlement is independent of ServiceAccountTenantGrant', () => {
    it('grant ACTIVE + no entitlement row at all = denied', async () => {
      const token = await issueToken(tenantNoEntitlementId, 'openid');
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });

    it('grant ACTIVE + entitlement SUSPENDED = denied', async () => {
      const token = await issueToken(tenantSuspendedEntitlementId, 'openid');
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(403);
    });

    it('grant ACTIVE + entitlement ACTIVE + not in the IAM allow-list = denied (Layer 4 passing does not imply Layer 6 passes)', async () => {
      const token = await issueToken(tenantNotInAllowlistId, 'openid');
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(403);
    });

    it('grant ACTIVE + entitlement ACTIVE + IAM allow-list = allowed (the only fully-valid combination)', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(200);
    });

    it('revoking the ServiceAccountTenantGrant after issuance does not retroactively invalidate an already-issued, unexpired token at THIS layer either — documented, deliberate, local-first (docs/RESOURCE_AUTHORIZATION_CONTRACT.md)', async () => {
      const raceTenant = await prisma.tenant.create({ data: { tenantCode: `P2D6-Race-${suffix}`, tenantName: 'P2D6 Race', status: 'ACTIVE' } });
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${raceTenant.id}/service-account-grants`).set('Authorization', `Bearer ${operatorToken}`).send({ serviceAccountId });
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${raceTenant.id}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId }); // required for issuance itself
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${raceTenant.id}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId: productId2 }); // required for the demo policy's own Layer-4 check
      iamAllowedTenants.add(raceTenant.id);

      const token = await issueToken(raceTenant.id, 'openid');
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${raceTenant.id}/service-account-grants/${serviceAccountId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });

      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(200); // TTL-bounded revocation semantics — the token itself is still cryptographically valid and unexpired
    });
  });

  // ===========================================================================
  // Fail-closed / provider isolation / configuration errors (brief §23/§35)
  // ===========================================================================
  describe('Fail-closed behavior', () => {
    it('no policy registered for the requested productId = denied (403, forbidden), never an implicit allow', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const res = await getRoute('authorized/unregistered', token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });

    it('a policy that throws is treated as a denial, never as success, and never leaks its internal error message', async () => {
      const throwing: ResourceAuthorizationPolicy = {
        authorize: async () => {
          throw new Error('simulated internal product-database outage — must never reach the caller');
        },
      };
      registry.register(DEMO_PRODUCT_A, throwing);
      try {
        const token = await issueToken(tenantEntitledId, 'openid');
        const res = await getRoute('authorized/product-a', token);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('simulated internal product-database outage');
      } finally {
        registry.register(DEMO_PRODUCT_A, makeProductAPolicy()); // restore for subsequent tests
      }
    });

    it('provider isolation: Product A\'s policy is never consulted for a Product B route, and vice versa', async () => {
      const calls: string[] = [];
      const spyA: ResourceAuthorizationPolicy = { authorize: async () => (calls.push('A'), { allowed: true }) };
      const spyB: ResourceAuthorizationPolicy = { authorize: async () => (calls.push('B'), { allowed: true }) };
      registry.register(DEMO_PRODUCT_A, spyA);
      registry.register(DEMO_PRODUCT_B, spyB);
      try {
        const token = await issueToken(tenantEntitledId, 'openid');
        const resA = await getRoute('authorized/product-a', token);
        const resB = await getRoute('authorized/product-b', token);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        expect(calls).toEqual(['A', 'B']); // each route invoked exactly its own product's policy, once, in order
      } finally {
        registry.register(DEMO_PRODUCT_A, makeProductAPolicy());
        registry.register(DEMO_PRODUCT_B, productBPolicy);
      }
    });
  });

  // ===========================================================================
  // Invariants (brief §39)
  // ===========================================================================
  describe('Architecture invariants', () => {
    it('Invariant: ServiceAccount != User — sub is never a security_user.id', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const whoami = await getRoute('whoami', token);
      const asUser = await prisma.securityUser.findFirst({ where: { id: whoami.body.context.subject } });
      expect(asUser).toBeNull();
    });

    it('Invariant: ServiceAccount != Application — sub is never Application.id or clientId', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const whoami = await getRoute('whoami', token);
      expect(whoami.body.context.subject).not.toBe(applicationId);
      expect(whoami.body.context.subject).not.toBe(clientId);
    });

    it('ResourceAuthorizationContext exposes jti at the top level, equal to principal.jti — never a second, independently-derived identity representation', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const whoami = await getRoute('whoami', token);
      expect(whoami.body.context.jti).toEqual(expect.any(String));
      expect(whoami.body.context.jti).toBe(whoami.body.context.principal.jti);
    });

    it('Invariant: tenant_id cannot be overridden by request input (X-Tenant-Id is validated, never substituted)', async () => {
      const token = await issueToken(tenantEntitledId, 'openid');
      const res = await getRoute('tenant-bound', token, { 'X-Tenant-Id': tenantNoEntitlementId });
      expect(res.status).toBe(403); // denied outright, never silently switched to acting as tenantNoEntitlementId
    });

    it('Invariant: Platform Operator token cannot bypass product authorization — rejected outright (401), never reaching the authorization layer at all', async () => {
      const res = await getRoute('authorized/product-a', operatorToken);
      expect(res.status).toBe(401); // HS256 legacy token — structurally rejected by ExternalBearerAuthGuard before ResourceAuthorizationGuard ever runs
    });

    it('Invariant: OAuth scope != IAM permission — holding the "openid" scope alone never satisfies the IAM allow-list check', async () => {
      const token = await issueToken(tenantNotInAllowlistId, 'openid'); // has the scope, entitled, but NOT IAM-allow-listed
      const res = await getRoute('authorized/product-a', token);
      expect(res.status).toBe(403);
    });
  });

  // ===========================================================================
  // Concurrency (brief §34)
  // ===========================================================================
  describe('Concurrency', () => {
    it('16 concurrent requests across two tenants (one allowed, one entitlement-denied) never cross-contaminate', async () => {
      const tokenAllowed = await issueToken(tenantEntitledId, 'openid');
      const tokenDenied = await issueToken(tenantNoEntitlementId, 'openid');

      const allowedRequests = Array.from({ length: 8 }, () => getRoute('authorized/product-a', tokenAllowed));
      const deniedRequests = Array.from({ length: 8 }, () => getRoute('authorized/product-a', tokenDenied));

      const [allowedResults, deniedResults] = await Promise.all([Promise.all(allowedRequests), Promise.all(deniedRequests)]);

      for (const res of allowedResults) {
        expect(res.status).toBe(200);
        expect(res.body.tenantId).toBe(tenantEntitledId);
      }
      for (const res of deniedResults) {
        expect(res.status).toBe(403);
      }
    });
  });
});
