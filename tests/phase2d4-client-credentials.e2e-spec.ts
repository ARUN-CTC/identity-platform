import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';

/**
 * Phase 2D.4 acceptance tests — OAuth 2.0 Client Credentials Flow
 * (docs/PHASE_2D4.md). Exercises the full, real `POST /oauth/token`
 * pipeline end to end against the live identity_platform_db, plus
 * independent cryptographic verification of the issued token via the real
 * JWKS endpoint (never merely decoding it). Additive to, not a restatement
 * of, tests/phase2d1-external-token-trust-boundary.e2e-spec.ts (signing
 * infra), tests/phase2d2-application-oauth-client.e2e-spec.ts (Application
 * config policies), and tests/phase2d3-service-account-tenant-grant.e2e-spec.ts
 * (ServiceAccount/grant lifecycle) — this suite is the first to actually
 * call the token endpoint.
 */
describe('Phase 2D.4 — OAuth 2.0 Client Credentials Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let issuer: string;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const AUDIENCE = `p2d4-resource-api-${suffix}`;
  const PRODUCT_SLUG = `p2d4-${suffix}`;
  // ApplicationScopePolicy requires every non-OIDC scope to be namespaced
  // under the registering Application's own Product slug.
  const SCOPE_READ = `${PRODUCT_SLUG}.read`;
  const SCOPE_WRITE = `${PRODUCT_SLUG}.write`;

  let operatorToken: string;
  let productId: string;
  let applicationId: string;
  let clientId: string;
  let clientSecret: string;
  let tenantId: string;
  let serviceAccountId: string;
  let serviceAccountSecret: string;

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

  /** Raw form-urlencoded POST — bypasses supertest's default JSON body, matching a real OAuth client. */
  function tokenRequest() {
    return request(app.getHttpServer()).post('/api/v1/oauth/token').type('form');
  }

  function basicAuthHeader(id: string, secret: string): string {
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  function validTokenBody(overrides: Record<string, string> = {}) {
    return {
      grant_type: 'client_credentials',
      service_account_id: serviceAccountId,
      service_account_secret: serviceAccountSecret,
      tenant_id: tenantId,
      audience: AUDIENCE,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    issuer = app.get(ConfigService).get<string>('OAUTH_ISSUER') ?? 'identity-platform';

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
      .send({ name: `P2D4 Product ${suffix}`, slug: `p2d4-${suffix}` });
    productId = product.body.id;

    const application = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D4 App ${suffix}`,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
        allowedScopes: [SCOPE_READ, SCOPE_WRITE],
        audiences: [AUDIENCE],
      });
    applicationId = application.body.id;
    clientId = application.body.clientId;
    clientSecret = application.body.clientSecret;
    expect(clientSecret).toEqual(expect.any(String));

    const serviceAccount = await request(app.getHttpServer())
      .post(`/api/v1/applications/${applicationId}/service-accounts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D4 SA ${suffix}` });
    serviceAccountId = serviceAccount.body.id;
    serviceAccountSecret = serviceAccount.body.credential;
    expect(serviceAccountSecret).toEqual(expect.any(String));

    const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-${suffix}`, tenantName: 'Phase 2D.4 Tenant', status: 'ACTIVE' } });
    tenantId = tenant.id;

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ serviceAccountId });

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productId });
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Positive end-to-end scenario (brief §45)
  // ===========================================================================
  describe('Positive end-to-end scenario', () => {
    it('issues an RS256 token through the full ACTIVE chain, independently verifiable via JWKS', async () => {
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ scope: SCOPE_READ }));

      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBeGreaterThan(0);
      expect(res.body.scope).toBe(SCOPE_READ);
      expect(res.body).not.toHaveProperty('refresh_token');
      expect(res.body).not.toHaveProperty('client_secret');
      expect(res.body).not.toHaveProperty('credential_hash');
      expect(res.body).not.toHaveProperty('private_key');

      // Independent cryptographic verification — never merely jwt.decode().
      const header = jwt.decode(res.body.access_token, { complete: true })!.header;
      expect(header.alg).toBe('RS256');
      expect(header.kid).toEqual(expect.any(String));

      const jwks = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(jwks.status).toBe(200);
      const matchingKey = jwks.body.keys.find((k: { kid: string }) => k.kid === header.kid);
      expect(matchingKey).toBeDefined();
      expect(matchingKey).not.toHaveProperty('d'); // structurally no private material

      const publicKeyPem = createPublicKey({ key: matchingKey, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
      const verified = jwt.verify(res.body.access_token, publicKeyPem, { algorithms: ['RS256'], issuer, audience: AUDIENCE }) as jwt.JwtPayload;

      expect(verified.sub).toBe(serviceAccountId); // never Application.id, never security_user.id
      expect(verified.sub).not.toBe(applicationId);
      expect(verified.aud).toBe(AUDIENCE);
      expect(verified.iss).toBe(issuer);
      expect(verified.client_id).toBe(clientId);
      expect(verified.tenant_id).toBe(tenantId);
      expect(verified.scope).toBe(SCOPE_READ);
      expect(verified.organization_id).toBeUndefined(); // never invented for a ServiceAccount
      expect(typeof verified.jti).toBe('string');
      expect(verified.exp).toEqual(expect.any(Number));
      expect(verified.iat).toEqual(expect.any(Number));
      expect(verified.exp as number).toBeGreaterThan(verified.iat as number);
    });

    it('omitting scope issues a token with no scope claim (never silently granting one)', async () => {
      const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody());
      expect(res.status).toBe(200);
      expect(res.body.scope).toBeUndefined();
    });
  });

  // ===========================================================================
  // Content-Type / request shape
  // ===========================================================================
  describe('Content-Type and request shape', () => {
    it('rejects a JSON content type outright', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/oauth/token')
        .set('Content-Type', 'application/json')
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody());
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('missing grant_type is denied', async () => {
      const body = validTokenBody();
      delete (body as Record<string, unknown>).grant_type;
      const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('unsupported grant type is denied with unsupported_grant_type', async () => {
      // Phase 2D.7 note: 'authorization_code' is no longer an unsupported
      // grant type at this endpoint (TokenController now routes it to
      // AuthorizationCodeGrantService — see tests/phase2d7-authorization-code-pkce.e2e-spec.ts)
      // — a genuinely unsupported grant type ('password', explicitly absent
      // from ApplicationGrantPolicy.GRANT_TYPES) is used here instead, to
      // keep testing this exact same ClientCredentialsService behavior.
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ grant_type: 'password' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_grant_type');
    });

    it('missing tenant_id, audience, or service account credentials are all denied as invalid_request', async () => {
      for (const omit of ['tenant_id', 'audience', 'service_account_id', 'service_account_secret']) {
        const body = validTokenBody();
        delete (body as Record<string, unknown>)[omit];
        const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_request');
      }
    });
  });

  // ===========================================================================
  // Full security attack matrix (brief §44)
  // ===========================================================================
  describe('Security attack matrix', () => {
    it('PUBLIC client using client_credentials is denied', async () => {
      const publicApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Public App ${suffix}`, clientType: 'PUBLIC', grantTypes: ['authorization_code'], redirectUris: ['https://example.com/cb'] });
      expect(publicApp.body.clientSecret).toBeNull();

      // No usable secret exists for a PUBLIC client — attempting Basic auth
      // with any guessed value must still fail generically.
      const res = await tokenRequest().set('Authorization', basicAuthHeader(publicApp.body.clientId, 'guessed-secret')).send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('suspended Application is denied', async () => {
      const app2 = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Suspend App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [], audiences: [AUDIENCE] });
      await request(app.getHttpServer()).patch(`/api/v1/applications/${app2.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'SUSPENDED' });

      const res = await tokenRequest().set('Authorization', basicAuthHeader(app2.body.clientId, app2.body.clientSecret)).send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('disabled Application is denied', async () => {
      const app3 = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Disable App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [], audiences: [AUDIENCE] });
      await request(app.getHttpServer()).patch(`/api/v1/applications/${app3.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });

      const res = await tokenRequest().set('Authorization', basicAuthHeader(app3.body.clientId, app3.body.clientSecret)).send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('invalid client secret is denied', async () => {
      const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, 'totally-wrong-secret')).send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('unknown client_id is denied identically to a wrong secret (no enumeration)', async () => {
      const res = await tokenRequest().set('Authorization', basicAuthHeader('cli_does_not_exist', 'whatever')).send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      expect(res.body.error_description).toBe('Client authentication failed');
    });

    it('missing client credentials (no Authorization header) is denied', async () => {
      const res = await tokenRequest().send(validTokenBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      expect(res.headers['www-authenticate']).toContain('Basic');
    });

    it('an application not configured for client_credentials is denied with unauthorized_client', async () => {
      const codeApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Code-Only App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['authorization_code'], redirectUris: ['https://example.com/cb'], audiences: [AUDIENCE] });

      const res = await tokenRequest().set('Authorization', basicAuthHeader(codeApp.body.clientId, codeApp.body.clientSecret)).send(validTokenBody());
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unauthorized_client');
    });

    it('inactive (DISABLED) ServiceAccount is denied', async () => {
      const sa2 = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA Disabled ${suffix}` });
      await request(app.getHttpServer()).patch(`/api/v1/service-accounts/${sa2.body.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: sa2.body.id });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: sa2.body.id, service_account_secret: sa2.body.credential }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('wrong ServiceAccount secret is denied', async () => {
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_secret: 'wrong-sa-secret' }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('no ServiceAccountTenantGrant at all is denied (deny-by-default)', async () => {
      const sa3 = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA No Grant ${suffix}` });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: sa3.body.id, service_account_secret: sa3.body.credential }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('suspended grant is denied', async () => {
      const sa4 = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA Suspend Grant ${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: sa4.body.id });
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantId}/service-account-grants/${sa4.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'SUSPENDED' });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: sa4.body.id, service_account_secret: sa4.body.credential }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('revoked grant is denied, and does not respond differently from "never granted"', async () => {
      const sa5 = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA Revoke Grant ${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: sa5.body.id });
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantId}/service-account-grants/${sa5.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });

      const revokedRes = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: sa5.body.id, service_account_secret: sa5.body.credential }));

      const sa6 = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA Never Granted ${suffix}` });
      const neverGrantedRes = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: sa6.body.id, service_account_secret: sa6.body.credential }));

      expect(revokedRes.status).toBe(neverGrantedRes.status);
      expect(revokedRes.body).toEqual(neverGrantedRes.body);
    });

    it('wrong tenant assertion (grant exists for a different tenant) is denied', async () => {
      const otherTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-OTHER-${suffix}`, tenantName: 'Other Tenant', status: 'ACTIVE' } });
      // serviceAccountId has a grant only for `tenantId`, not otherTenant.
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ tenant_id: otherTenant.id }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('inactive (SUSPENDED) tenant is denied without mutating the grant', async () => {
      const suspendTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-SUSPEND-${suffix}`, tenantName: 'Suspend Tenant', status: 'SUSPENDED' } });
      const saForSuspendTenant = await request(app.getHttpServer())
        .post(`/api/v1/applications/${applicationId}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA Suspend Tenant ${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${suspendTenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: saForSuspendTenant.body.id });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ tenant_id: suspendTenant.id, service_account_id: saForSuspendTenant.body.id, service_account_secret: saForSuspendTenant.body.credential }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');

      const grantAfter = await prismaContext.runInContext(
        (tx) => tx.serviceAccountTenantGrant.findFirst({ where: { tenantId: suspendTenant.id, serviceAccountId: saForSuspendTenant.body.id } }),
        suspendTenant.id,
      );
      expect(grantAfter?.status).toBe('ACTIVE'); // denial never mutates the grant
    });

    it('no TenantProductEntitlement is denied even with an ACTIVE grant', async () => {
      const noEntitlementTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-NOENT-${suffix}`, tenantName: 'No Entitlement Tenant', status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${noEntitlementTenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ tenant_id: noEntitlementTenant.id }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('suspended TenantProductEntitlement is denied even with everything else ACTIVE', async () => {
      const suspendEntTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-SUSPENT-${suffix}`, tenantName: 'Suspend Entitlement Tenant', status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${suspendEntTenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${suspendEntTenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId });
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${suspendEntTenant.id}/product-entitlements/${productId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'SUSPENDED' });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ tenant_id: suspendEntTenant.id }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('suspended Product is denied even when grant + entitlement are both ACTIVE', async () => {
      const productForSuspend = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Suspend Product ${suffix}`, slug: `p2d4-suspend-${suffix}` });
      const appForSuspendProduct = await request(app.getHttpServer())
        .post(`/api/v1/products/${productForSuspend.body.id}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 App For Suspend Product ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [], audiences: [`p2d4-suspend-aud-${suffix}`] });
      const saForSuspendProduct = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appForSuspendProduct.body.id}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 SA For Suspend Product ${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: saForSuspendProduct.body.id });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId: productForSuspend.body.id });
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${productForSuspend.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'DISABLED' });

      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(appForSuspendProduct.body.clientId, appForSuspendProduct.body.clientSecret))
        .send(
          validTokenBody({
            audience: `p2d4-suspend-aud-${suffix}`,
            service_account_id: saForSuspendProduct.body.id,
            service_account_secret: saForSuspendProduct.body.credential,
          }),
        );
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('unauthorized scope is denied with invalid_scope', async () => {
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ scope: 'not-an-allowed-scope' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_scope');
    });

    it('unauthorized audience is denied with invalid_target', async () => {
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ audience: 'some-other-unregistered-api' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_target');
    });

    it('wildcard audience is denied with invalid_target', async () => {
      for (const wildcard of ['*', 'all', 'any']) {
        const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ audience: wildcard }));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_target');
      }
    });

    it('cross-application ServiceAccount selection is denied: a ServiceAccount belonging to a different Application cannot be used', async () => {
      const otherApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Other App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [], audiences: [AUDIENCE] });
      const otherSa = await request(app.getHttpServer())
        .post(`/api/v1/applications/${otherApp.body.id}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D4 Other App SA ${suffix}` });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: otherSa.body.id });

      // Authenticate as the ORIGINAL application, but try to act as the
      // OTHER application's own ServiceAccount.
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ service_account_id: otherSa.body.id, service_account_secret: otherSa.body.credential }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });

    it('a valid Application credential alone never grants access to an arbitrary tenant (the non-negotiable invariant)', async () => {
      const arbitraryTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-ARB-${suffix}`, tenantName: 'Arbitrary Tenant', status: 'ACTIVE' } });
      // Correct Application + correct ServiceAccount credentials, but NO
      // grant exists for this tenant at all.
      const res = await tokenRequest()
        .set('Authorization', basicAuthHeader(clientId, clientSecret))
        .send(validTokenBody({ tenant_id: arbitraryTenant.id }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('access_denied');
    });
  });

  // ===========================================================================
  // Cross-tenant protection & revocation immediacy (brief §17)
  // ===========================================================================
  describe('Cross-tenant protection and revocation immediacy', () => {
    it('grants for Tenant A and Tenant B are independent, and revoking A does not affect B — then revoking A denies A immediately', async () => {
      const tenantA = await prisma.tenant.create({ data: { tenantCode: `P2D4-XT-A-${suffix}`, tenantName: 'Cross Tenant A', status: 'ACTIVE' } });
      const tenantB = await prisma.tenant.create({ data: { tenantCode: `P2D4-XT-B-${suffix}`, tenantName: 'Cross Tenant B', status: 'ACTIVE' } });
      for (const t of [tenantA, tenantB]) {
        await request(app.getHttpServer())
          .post(`/api/v1/platform/tenants/${t.id}/service-account-grants`)
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ serviceAccountId });
        await request(app.getHttpServer())
          .post(`/api/v1/platform/tenants/${t.id}/product-entitlements`)
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ productId });
      }

      const beforeA = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantA.id }));
      const beforeB = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantB.id }));
      expect(beforeA.status).toBe(200);
      expect(beforeB.status).toBe(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${tenantA.id}/service-account-grants/${serviceAccountId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ status: 'REVOKED' });

      const afterA = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantA.id }));
      const afterB = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantB.id }));
      expect(afterA.status).toBe(403); // immediate — no cached authorization decision survives
      expect(afterB.status).toBe(200); // completely unaffected
    });
  });

  // ===========================================================================
  // Concurrency (brief §42/43)
  // ===========================================================================
  describe('Concurrency', () => {
    it('multiple simultaneous valid requests for the same client + tenant all authenticate correctly', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody())));
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.access_token).toEqual(expect.any(String));
      }
      // Every issued token has a distinct jti — no shared/cached token reused across concurrent callers.
      const jtis = results.map((r) => (jwt.decode(r.body.access_token) as jwt.JwtPayload).jti);
      expect(new Set(jtis).size).toBe(jtis.length);
    });

    it('concurrent requests for the same ServiceAccount against two different tenants remain isolated (no CLS/context bleed)', async () => {
      const tenantX = await prisma.tenant.create({ data: { tenantCode: `P2D4-CC-X-${suffix}`, tenantName: 'Concurrency Tenant X', status: 'ACTIVE' } });
      const tenantY = await prisma.tenant.create({ data: { tenantCode: `P2D4-CC-Y-${suffix}`, tenantName: 'Concurrency Tenant Y', status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantX.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantX.id}/product-entitlements`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId });
      // tenantY deliberately gets NO grant — must never leak into X's requests.

      const [resultsX, resultsY] = await Promise.all([
        Promise.all(Array.from({ length: 4 }, () => tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantX.id })))),
        Promise.all(Array.from({ length: 4 }, () => tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: tenantY.id })))),
      ]);

      for (const res of resultsX) {
        expect(res.status).toBe(200);
        const claims = jwt.decode(res.body.access_token) as jwt.JwtPayload;
        expect(claims.tenant_id).toBe(tenantX.id); // never bled into tenantY
      }
      for (const res of resultsY) {
        expect(res.status).toBe(403); // no grant for Y — never incorrectly allowed
      }
    });

    it('a revocation racing with in-flight requests never leaves a path to a granted token afterward', async () => {
      const raceTenant = await prisma.tenant.create({ data: { tenantCode: `P2D4-RACE-${suffix}`, tenantName: 'Race Tenant', status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${raceTenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${raceTenant.id}/product-entitlements`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId });

      await Promise.all([
        tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: raceTenant.id })),
        request(app.getHttpServer())
          .patch(`/api/v1/platform/tenants/${raceTenant.id}/service-account-grants/${serviceAccountId}`)
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ status: 'REVOKED' }),
      ]);

      // Regardless of race outcome during the overlap, a request AFTER both
      // have settled must be deterministically denied.
      const after = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ tenant_id: raceTenant.id }));
      expect(after.status).toBe(403);
    });
  });

  // ===========================================================================
  // Audit
  // ===========================================================================
  describe('Audit', () => {
    it('records OAUTH_TOKEN_ISSUED on success, and OAUTH_TOKEN_DENIED on failure, with no secret/token material in metadata', async () => {
      const successRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ scope: SCOPE_WRITE }));
      expect(successRes.status).toBe(200);

      const deniedRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send(validTokenBody({ scope: 'not-allowed' }));
      expect(deniedRes.status).toBe(400);

      // Filtered on a distinguishing metadata field, not merely "most
      // recent" — this suite's shared serviceAccountId fixture accumulates
      // many OAUTH_TOKEN_ISSUED/_DENIED events across earlier tests, so
      // recency alone is not a reliable way to pick out THESE two calls'
      // own events.
      const successEvent = await prisma.securityEvent.findFirst({
        where: {
          eventType: 'OAUTH_TOKEN_ISSUED',
          resourceId: serviceAccountId,
          scope: 'PLATFORM',
          metadata: { path: ['requestedScopes'], array_contains: SCOPE_WRITE },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(successEvent).not.toBeNull();
      const successMetadata = successEvent!.metadata as Record<string, unknown>;
      expect(successMetadata.tenantId).toBe(tenantId);
      expect(successMetadata.applicationId).toBe(applicationId);
      const successMetadataString = JSON.stringify(successMetadata);
      expect(successMetadataString).not.toContain(clientSecret);
      expect(successMetadataString).not.toContain(serviceAccountSecret);
      expect(successMetadataString).not.toContain(successRes.body.access_token);

      // Note: resourceId is NOT filtered here — a scope denial happens
      // during Application eligibility (step 3), before the ServiceAccount
      // is ever resolved (step 4), so this event's own resourceId is
      // genuinely absent (reflects what was actually known at the point of
      // denial) — matched instead on the requested-scope value, unique to
      // this one call across the whole suite.
      const deniedEvent = await prisma.securityEvent.findFirst({
        where: {
          eventType: 'OAUTH_TOKEN_DENIED',
          scope: 'PLATFORM',
          metadata: { path: ['requestedScopes'], array_contains: 'not-allowed' },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(deniedEvent).not.toBeNull();
      const deniedMetadata = deniedEvent!.metadata as Record<string, unknown>;
      expect(deniedMetadata.reasonCode).toBe('scope_not_allowed');
      const deniedMetadataString = JSON.stringify(deniedMetadata);
      expect(deniedMetadataString).not.toContain(clientSecret);
      expect(deniedMetadataString).not.toContain(serviceAccountSecret);
    });
  });
});
