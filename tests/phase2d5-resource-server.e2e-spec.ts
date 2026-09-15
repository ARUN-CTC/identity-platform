import '../src/common/bigint-json.polyfill';

import type { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaService } from '../src/database';
import { JwksClientService } from '../src/modules/resource-server/services';
import { SigningKeyService } from '../src/modules/oauth/services';

/**
 * Phase 2D.5 acceptance tests — Resource Server JWT Validation &
 * Authorization Context (docs/RESOURCE_SERVER_ARCHITECTURE.md). Unlike
 * every prior e2e suite in this repo, this one calls `app.listen(0)` and
 * points `JwksClientService` at that REAL, listening server's own
 * `/.well-known/jwks.json` — proving genuine over-the-network JWKS
 * resolution (brief §33), not merely an in-process shortcut. Tokens are
 * issued through the real, unmodified `POST /oauth/token` (Phase 2D.4)
 * pipeline; some negative-path tokens are hand-signed using the running
 * app's own real signing key (obtained via `app.get(SigningKeyService)`,
 * exactly mirroring `tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`'s
 * own established pattern) to produce a cryptographically VALID signature
 * with a deliberately wrong claim — the only way to genuinely test claim
 * validation independent of signature validity.
 */
describe('Phase 2D.5 — Resource Server JWT Validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwksClient: JwksClientService;
  let signingKeys: SigningKeyService;
  let issuer: string;
  let baseUrl: string;
  let jwksUrl: string;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const DEMO_AUDIENCE = 'resource-server-demo-api';

  let operatorToken: string;
  let productId: string;
  let applicationId: string;
  let clientId: string;
  let clientSecret: string;
  let tenantId: string;
  let serviceAccountId: string;
  let serviceAccountSecret: string;
  let scopedApplicationId: string;
  let scopedClientId: string;
  let scopedClientSecret: string;
  let scopedServiceAccountId: string;
  let scopedServiceAccountSecret: string;

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

  /** Issues a real access token through the actual, unmodified Phase 2D.4 pipeline. */
  async function issueRealToken(overrides: Record<string, string> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`)
      .send({ grant_type: 'client_credentials', service_account_id: serviceAccountId, service_account_secret: serviceAccountSecret, tenant_id: tenantId, audience: DEMO_AUDIENCE, ...overrides });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  function whoami(token?: string) {
    const req = request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();
    await app.listen(0); // real TCP listener — required for a genuine over-the-network JWKS fetch

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    jwksUrl = `${baseUrl}/.well-known/jwks.json`;

    prisma = app.get(PrismaService);
    jwksClient = app.get(JwksClientService);
    signingKeys = app.get(SigningKeyService);
    issuer = app.get(ConfigService).get<string>('OAUTH_ISSUER') ?? 'identity-platform';
    jwksClient.configureJwksUri(jwksUrl);

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
      .send({ name: `P2D5 Product ${suffix}`, slug: `p2d5-${suffix}` });
    productId = product.body.id;

    const application = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D5 App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [`p2d5-${suffix}.read`], audiences: [DEMO_AUDIENCE] });
    applicationId = application.body.id;
    clientId = application.body.clientId;
    clientSecret = application.body.clientSecret;

    const serviceAccount = await request(app.getHttpServer())
      .post(`/api/v1/applications/${applicationId}/service-accounts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D5 SA ${suffix}` });
    serviceAccountId = serviceAccount.body.id;
    serviceAccountSecret = serviceAccount.body.credential;

    const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D5-${suffix}`, tenantName: 'Phase 2D.5 Tenant', status: 'ACTIVE' } });
    tenantId = tenant.id;

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ serviceAccountId });
    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productId });

    // A second, independent Application/ServiceAccount registered with the
    // demo scope, used by the scope-enforcement + concurrency tests.
    const scopedApplication = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D5 Scoped App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: ['openid'], audiences: [DEMO_AUDIENCE] });
    scopedApplicationId = scopedApplication.body.id;
    scopedClientId = scopedApplication.body.clientId;
    scopedClientSecret = scopedApplication.body.clientSecret;
    const scopedServiceAccount = await request(app.getHttpServer())
      .post(`/api/v1/applications/${scopedApplicationId}/service-accounts`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D5 Scoped SA ${suffix}` });
    scopedServiceAccountId = scopedServiceAccount.body.id;
    scopedServiceAccountSecret = scopedServiceAccount.body.credential;
    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ serviceAccountId: scopedServiceAccountId });
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Positive path + live JWKS verification (brief §33/§45)
  // ===========================================================================
  describe('Positive path — live JWKS verification', () => {
    it('a valid external token + correct audience is accepted, principal correctly constructed', async () => {
      const token = await issueRealToken();
      const res = await whoami(token);
      expect(res.status).toBe(200);
      expect(res.body.context.subject).toBe(serviceAccountId); // sub -> ServiceAccount.id
      expect(res.body.context.serviceAccountId).toBe(serviceAccountId);
      expect(res.body.context.tenantId).toBe(tenantId);
      expect(res.body.context.clientId).toBe(clientId);
      expect(res.body.context.audience).toBe(DEMO_AUDIENCE);
      expect(res.body.context.principal.type).toBe('SERVICE_ACCOUNT');
      expect(res.body.clsMatchesRequest).toBe(true); // request-attached and CLS-attached principal are the same value
    });

    it('the JWKS response never contains private key material', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(res.status).toBe(200);
      for (const key of res.body.keys) {
        expect(key).not.toHaveProperty('d');
        expect(key).not.toHaveProperty('p');
        expect(key).not.toHaveProperty('q');
      }
    });
  });

  // ===========================================================================
  // E2E security matrix (brief §31)
  // ===========================================================================
  describe('Security matrix', () => {
    it('wrong audience is rejected (401)', async () => {
      // Issue a token for a DIFFERENT audience (not registered on the demo
      // endpoint) by requesting a second audience the Application is also
      // configured for — simplest: request the demo audience via issuance,
      // then present it against an endpoint expecting a different one is
      // not directly testable without a second protected route, so instead
      // we validate the inverse: a token issued for a non-demo audience
      // (not possible here since the Application only has DEMO_AUDIENCE) —
      // exercised instead via a hand-signed forged token with a different aud.
      const { privateKeyPem, kid } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: kid,
        issuer,
        audience: 'a-completely-different-audience',
        expiresIn: 900,
      });
      const res = await whoami(forged);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_token');
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('wrong issuer is rejected (401) — correctly signed, wrong iss', async () => {
      const { privateKeyPem, kid } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: kid,
        issuer: 'https://attacker.example.com',
        audience: DEMO_AUDIENCE,
        expiresIn: 900,
      });
      const res = await whoami(forged);
      expect(res.status).toBe(401);
    });

    it('expired token is rejected (401)', async () => {
      const { privateKeyPem, kid } = signingKeys.getSigningKey();
      const forged = jwt.sign(
        { sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID(), iat: Math.floor(Date.now() / 1000) - 1000 },
        privateKeyPem,
        { algorithm: 'RS256', keyid: kid, issuer, audience: DEMO_AUDIENCE, expiresIn: 1 },
      );
      const res = await whoami(forged);
      expect(res.status).toBe(401);
    });

    it('a legacy HS256 token is rejected outright (401) — never accepted by the external validator', async () => {
      const hs256 = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, 'arbitrary-guessed-secret', {
        algorithm: 'HS256',
        issuer,
        audience: DEMO_AUDIENCE,
        expiresIn: 900,
      });
      const res = await whoami(hs256);
      expect(res.status).toBe(401);
    });

    it('a forged RS256 token (attacker-owned keypair, correct kid claimed) is rejected — signature verification fails', async () => {
      const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
      const { kid } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, attackerKeys.privateKey, {
        algorithm: 'RS256',
        keyid: kid, // claims the REAL kid, but is signed with a different key entirely
        issuer,
        audience: DEMO_AUDIENCE,
        expiresIn: 900,
      });
      const res = await whoami(forged);
      expect(res.status).toBe(401);
    });

    it('alg=none is rejected outright', async () => {
      const noneToken = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, '', { algorithm: 'none' });
      const res = await whoami(noneToken);
      expect(res.status).toBe(401);
    });

    it('an unknown kid is rejected', async () => {
      const { privateKeyPem } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: 'totally-unknown-kid',
        issuer,
        audience: DEMO_AUDIENCE,
        expiresIn: 900,
      });
      const res = await whoami(forged);
      expect(res.status).toBe(401);
    });

    it('missing bearer is rejected (401)', async () => {
      const res = await whoami();
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('malformed bearer syntax is rejected (401)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', 'Bearer');
      expect(res.status).toBe(401);
    });

    it('a Basic auth header is rejected outright (401), never algorithm-negotiated into acceptance', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Basic ${Buffer.from('foo:bar').toString('base64')}`);
      expect(res.status).toBe(401);
    });

    it('a missing tenant_id claim is rejected', async () => {
      const { privateKeyPem, kid } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, jti: randomUUID() }, privateKeyPem, { algorithm: 'RS256', keyid: kid, issuer, audience: DEMO_AUDIENCE, expiresIn: 900 });
      const res = await whoami(forged);
      expect(res.status).toBe(401);
    });

    it('missing scope (token issued with no scope requested) is accepted — scope absence means "no scopes," not a validation failure', async () => {
      const token = await issueRealToken(); // no `scope` field sent to /oauth/token
      const res = await whoami(token);
      expect(res.status).toBe(200);
      expect(res.body.context.scopes).toEqual([]);
    });

    it('a caller-supplied X-Tenant-Id matching the token is allowed', async () => {
      const token = await issueRealToken();
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/tenant-bound').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantId);
      expect(res.status).toBe(200);
    });

    it('a caller-supplied X-Tenant-Id that DIFFERS from the token is denied (403) — never silently switched', async () => {
      const token = await issueRealToken();
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/tenant-bound').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', randomUUID());
      expect(res.status).toBe(403);
    });

    it('a valid token with an insufficient scope is denied (403) at the product-owned scope check', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/oauth/token')
        .type('form')
        .set('Authorization', `Basic ${Buffer.from(`${scopedClientId}:${scopedClientSecret}`).toString('base64')}`)
        .send({
          grant_type: 'client_credentials',
          service_account_id: scopedServiceAccountId,
          service_account_secret: scopedServiceAccountSecret,
          tenant_id: tenantId,
          audience: DEMO_AUDIENCE,
          // no scope requested at all
        });
      expect(res.status).toBe(200);
      const scopedRes = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/scoped').set('Authorization', `Bearer ${res.body.access_token}`);
      expect(scopedRes.status).toBe(403);
      expect(scopedRes.body.error).toBe('insufficient_scope');
    });

    it('a valid token WITH the required scope is allowed through the scoped endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/oauth/token')
        .type('form')
        .set('Authorization', `Basic ${Buffer.from(`${scopedClientId}:${scopedClientSecret}`).toString('base64')}`)
        .send({
          grant_type: 'client_credentials',
          service_account_id: scopedServiceAccountId,
          service_account_secret: scopedServiceAccountSecret,
          tenant_id: tenantId,
          audience: DEMO_AUDIENCE,
          scope: 'openid',
        });
      expect(res.status).toBe(200);
      const scopedRes = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/scoped').set('Authorization', `Bearer ${res.body.access_token}`);
      expect(scopedRes.status).toBe(200);
    });

    it('a token whose sub was tampered with post-signature (attempting User/Application-id confusion) is rejected — signature no longer matches', async () => {
      const token = await issueRealToken();
      const [h, p, s] = token.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.sub = randomUUID(); // attacker attempts to substitute a different subject
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const res = await whoami(`${h}.${tamperedPayload}.${s}`);
      expect(res.status).toBe(401);
    });

    it('multiple/ambiguous Authorization headers are safely rejected, never resolved by "take the first"', async () => {
      // Node's http layer collapses genuinely duplicated headers of most
      // kinds into a single, comma-joined value before Express ever sees
      // them — this is that exact shape (already unit-tested at the
      // extraction-utility level for the array shape too, which some
      // proxies/frameworks produce instead).
      const token = await issueRealToken();
      const res = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${token}, Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // JWKS availability (brief §31 last two rows)
  // ===========================================================================
  describe('JWKS availability', () => {
    it('a valid token still verifies using an already-cached key even while JWKS is currently unreachable', async () => {
      const token = await issueRealToken();
      // Warm the cache first (real fetch against the real, reachable JWKS).
      const warm = await whoami(token);
      expect(warm.status).toBe(200);

      jwksClient.configureJwksUri('http://127.0.0.1:1/.well-known/jwks.json'); // deliberately unreachable
      const token2 = await issueRealToken(); // signed with the SAME already-cached kid
      const res = await whoami(token2);
      expect(res.status).toBe(200);

      jwksClient.configureJwksUri(jwksUrl); // restore for subsequent tests
    });

    it('an unknown kid while JWKS is unreachable fails closed (401), never guessed', async () => {
      jwksClient.configureJwksUri('http://127.0.0.1:1/.well-known/jwks.json');
      const { privateKeyPem } = signingKeys.getSigningKey();
      const forged = jwt.sign({ sub: serviceAccountId, client_id: clientId, tenant_id: tenantId, jti: randomUUID() }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: 'a-kid-never-cached-and-jwks-is-down',
        issuer,
        audience: DEMO_AUDIENCE,
        expiresIn: 900,
      });
      const res = await whoami(forged);
      expect(res.status).toBe(401);

      jwksClient.configureJwksUri(jwksUrl); // restore
    });
  });

  // ===========================================================================
  // Concurrency (brief §32)
  // ===========================================================================
  describe('Concurrency / CLS isolation', () => {
    it('concurrent requests for two different ServiceAccounts/tenants never contaminate each other\'s principal', async () => {
      const tenantB = await prisma.tenant.create({ data: { tenantCode: `P2D5-B-${suffix}`, tenantName: 'Phase 2D.5 Tenant B', status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantB.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: scopedServiceAccountId });
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantB.id}/product-entitlements`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ productId });

      const tokenA = await issueRealToken(); // serviceAccountId / tenantId (A)
      const tokenBRes = await request(app.getHttpServer())
        .post('/api/v1/oauth/token')
        .type('form')
        .set('Authorization', `Basic ${Buffer.from(`${scopedClientId}:${scopedClientSecret}`).toString('base64')}`)
        .send({ grant_type: 'client_credentials', service_account_id: scopedServiceAccountId, service_account_secret: scopedServiceAccountSecret, tenant_id: tenantB.id, audience: DEMO_AUDIENCE });
      expect(tokenBRes.status).toBe(200);
      const tokenB = tokenBRes.body.access_token;

      const iterations = 8;
      const requestsA = Array.from({ length: iterations }, () => whoami(tokenA));
      const requestsB = Array.from({ length: iterations }, () =>
        request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${tokenB}`),
      );

      const [resultsA, resultsB] = await Promise.all([Promise.all(requestsA), Promise.all(requestsB)]);

      for (const res of resultsA) {
        expect(res.status).toBe(200);
        expect(res.body.context.serviceAccountId).toBe(serviceAccountId);
        expect(res.body.context.tenantId).toBe(tenantId);
      }
      for (const res of resultsB) {
        expect(res.status).toBe(200);
        expect(res.body.context.serviceAccountId).toBe(scopedServiceAccountId);
        expect(res.body.context.tenantId).toBe(tenantB.id);
      }
    });
  });
});
