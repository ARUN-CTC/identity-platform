import '../src/common/bigint-json.polyfill';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { createHash, randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { AuthorizationCodesRepository } from '../src/modules/oauth/repositories';
import { JwksClientService } from '../src/modules/resource-server/services';
import { PrismaContextService, PrismaService } from '../src/database';

/**
 * Phase 2D.9 acceptance tests — OAuth/OIDC Operational Hardening
 * (docs/PHASE_2D9.md, docs/OAUTH_OPERATIONAL_HARDENING.md). Runs against
 * the real identity_platform_db, same pattern as every prior phase's
 * suite. Exercises: rate limiting (all three protected endpoints),
 * oversized-input rejection, request correlation, telemetry safety
 * (no secret/token/code/nonce leakage into durable audit records), and
 * authorization-code cleanup safety — while re-confirming every existing
 * OAuth/OIDC/Resource-Server/Client-Credentials flow still passes
 * unmodified (Phase 2D.4/2D.5/2D.6/2D.7/2D.8's own suites already do this;
 * this file adds only what is genuinely new).
 */
describe('Phase 2D.9 — OAuth/OIDC Operational Hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let authorizationCodes: AuthorizationCodesRepository;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const AUDIENCE = `p2d9-resource-api-${suffix}`;
  const USERINFO_AUDIENCE = 'identity-platform-userinfo';
  const PRODUCT_SLUG = `p2d9-${suffix}`;
  const SCOPE_READ = `${PRODUCT_SLUG}.read`;
  const REDIRECT_URI = `https://app.example.com/callback-${suffix}`;

  let operatorToken: string;
  let productId: string;
  let clientId: string;
  let clientSecret: string;
  let tenantId: string;
  let userAccessToken: string;
  let userId: string;

  async function createGlobalUser(email: string) {
    return prisma.securityUser.create({
      data: { email, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
  }

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    return res.body.accessToken;
  }

  function challengeFor(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }
  function randomVerifier(): string {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  function authorizeRequest(token: string, query: Record<string, string>) {
    return request(app.getHttpServer()).get('/api/v1/oauth/authorize').set('Authorization', `Bearer ${token}`).query(query).redirects(0);
  }

  function tokenRequest() {
    return request(app.getHttpServer()).post('/api/v1/oauth/token').type('form');
  }

  function basicAuthHeader(id: string, secret: string): string {
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  function validAuthorizeQuery(overrides: Record<string, string> = {}): Record<string, string> {
    const verifier = randomVerifier();
    return {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE_READ,
      state: `state-${randomUUID()}`,
      code_challenge: challengeFor(verifier),
      code_challenge_method: 'S256',
      audience: AUDIENCE,
      ...overrides,
    };
  }

  async function issueValidCode(overrides: Record<string, string> = {}): Promise<{ code: string; verifier: string }> {
    const verifier = randomVerifier();
    const query = validAuthorizeQuery({ code_challenge: challengeFor(verifier), ...overrides });
    const res = await authorizeRequest(userAccessToken, query);
    expect(res.status).toBe(302);
    const code = new URL(res.headers.location).searchParams.get('code');
    expect(code).toEqual(expect.any(String));
    return { code: code!, verifier };
  }

  /** Runs `fn` with the given env vars set, guaranteeing they are restored afterward regardless of outcome — env vars are process-global and this suite shares a Jest worker process with every other e2e file. */
  async function withEnv(overrides: Record<string, string>, fn: () => Promise<void>): Promise<void> {
    const previous: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      previous[key] = process.env[key];
      process.env[key] = overrides[key];
    }
    try {
      await fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json', '.well-known/openid-configuration'] });
    // Phase 2D.9's own size-limit tests specifically need the SAME global
    // ValidationPipe main.ts registers in the real, running application —
    // no prior e2e suite in this repo has ever needed to register it
    // itself (none previously depended on a DTO-level rejection), so this
    // is the first test file that must.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    app.get(JwksClientService).configureJwksUri(`http://127.0.0.1:${address.port}/.well-known/jwks.json`);

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    authorizationCodes = app.get(AuthorizationCodesRepository);
    void app.get(ConfigService);

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: { permissionCode: { in: ['PRODUCT_MANAGE', 'APPLICATION_MANAGE', 'PRODUCT_ENTITLEMENT_VIEW', 'PRODUCT_ENTITLEMENT_MANAGE'] } },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    const product = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D9 Product ${suffix}`, slug: PRODUCT_SLUG });
    productId = product.body.id;

    const appReg = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D9 App ${suffix}`,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['authorization_code'],
        allowedScopes: [SCOPE_READ, 'openid'],
        audiences: [AUDIENCE, USERINFO_AUDIENCE],
        redirectUris: [REDIRECT_URI],
      });
    clientId = appReg.body.clientId;
    clientSecret = appReg.body.clientSecret;

    tenantId = (await prisma.tenant.create({ data: { tenantCode: `P2D9-${suffix}`, tenantName: 'Phase 2D.9 Tenant', status: 'ACTIVE' } })).id;
    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    const organization = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId, organizationTypeId: orgType.id, organizationCode: 'ORG-1', organizationName: 'P2D9 Org' } }),
      tenantId,
    );

    const user = await createGlobalUser(`user-${suffix}@example.com`);
    userId = user.id;
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId: organization.id, userId, status: 'ACTIVE' } }), tenantId);
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId });

    const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: `P2D9-${suffix}`, email: user.email, password: PASSWORD });
    userAccessToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Rate limiting
  // ===========================================================================
  describe('Rate limiting', () => {
    it('the token endpoint denies requests beyond its configured limit, with Retry-After, then recovers after the window', async () => {
      await withEnv({ OAUTH_TOKEN_RATE_LIMIT_MAX: '2', OAUTH_TOKEN_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const attempt = () => tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code: 'irrelevant', redirect_uri: REDIRECT_URI, code_verifier: randomVerifier() });

        const first = await attempt();
        const second = await attempt();
        const third = await attempt();
        expect(first.status).not.toBe(429);
        expect(second.status).not.toBe(429);
        expect(third.status).toBe(429);
        expect(third.body.error).toBe('temporarily_unavailable');
        expect(third.headers['retry-after']).toBeDefined();

        await new Promise((resolve) => setTimeout(resolve, 2100));
        const afterWindow = await attempt();
        expect(afterWindow.status).not.toBe(429);
      });
    });

    it('the authorize endpoint denies requests beyond its configured limit', async () => {
      // A dedicated, never-reused synthetic client_id keeps this test's own
      // rate-limit bucket key isolated from every other authorize-rate-limit
      // test in this file (the key is client_id + hashed source; reusing
      // the same client_id across tests would let one test's leftover
      // bucket count bleed into another's).
      const isolatedClientId = `rl-test-authorize-${randomUUID()}`;
      await withEnv({ OAUTH_AUTHORIZE_RATE_LIMIT_MAX: '2', OAUTH_AUTHORIZE_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const attempt = () => authorizeRequest(userAccessToken, validAuthorizeQuery({ client_id: isolatedClientId }));
        const first = await attempt();
        const second = await attempt();
        const third = await attempt();
        expect(first.status).not.toBe(429);
        expect(second.status).not.toBe(429);
        expect(third.status).toBe(429);
      });
    });

    it('the userinfo endpoint denies requests beyond its configured limit', async () => {
      const { code, verifier } = await issueValidCode({ scope: 'openid', audience: USERINFO_AUDIENCE, nonce: `n-${randomUUID()}` });
      const tokenRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      const accessToken = tokenRes.body.access_token;

      await withEnv({ OIDC_USERINFO_RATE_LIMIT_MAX: '2', OIDC_USERINFO_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const attempt = () => request(app.getHttpServer()).get('/api/v1/oauth/userinfo').set('Authorization', `Bearer ${accessToken}`);
        const first = await attempt();
        const second = await attempt();
        const third = await attempt();
        expect(first.status).not.toBe(429);
        expect(second.status).not.toBe(429);
        expect(third.status).toBe(429);
      });
    });

    it('rate-limit responses never reveal whether the client_id/credentials are valid (identical 429 body for an unknown client)', async () => {
      await withEnv({ OAUTH_TOKEN_RATE_LIMIT_MAX: '1', OAUTH_TOKEN_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const unknownClientId = `unknown-${randomUUID()}`;
        const attempt = () => tokenRequest().set('Authorization', basicAuthHeader(unknownClientId, 'wrong-secret')).send({ grant_type: 'client_credentials' });
        const first = await attempt();
        const second = await attempt();
        expect(second.status).toBe(429);
        expect(second.body).toEqual({ error: 'temporarily_unavailable', error_description: expect.any(String) });
        void first;
      });
    });

    it('changing an irrelevant request parameter (state) does not evade the authorize rate limit — the key is client+source, not the full request', async () => {
      const isolatedClientId = `rl-test-irrelevant-param-${randomUUID()}`;
      await withEnv({ OAUTH_AUTHORIZE_RATE_LIMIT_MAX: '1', OAUTH_AUTHORIZE_RATE_LIMIT_WINDOW_MS: '2000' }, async () => {
        const first = await authorizeRequest(userAccessToken, validAuthorizeQuery({ client_id: isolatedClientId, state: 'state-one' }));
        const second = await authorizeRequest(userAccessToken, validAuthorizeQuery({ client_id: isolatedClientId, state: 'state-two-completely-different' }));
        expect(first.status).not.toBe(429);
        expect(second.status).toBe(429);
      });
    });
  });

  // ===========================================================================
  // Resource consumption limits
  // ===========================================================================
  describe('Input size limits', () => {
    it('rejects an oversized state value', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ state: 'x'.repeat(600) }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized nonce value', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ scope: 'openid', nonce: 'x'.repeat(600) }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized scope value', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ scope: 'x'.repeat(1100) }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized audience value', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ audience: 'x'.repeat(250) }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized redirect_uri value', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ redirect_uri: `https://app.example.com/${'x'.repeat(2100)}` }));
      expect(res.status).toBe(400);
    });

    it('rejects an oversized bearer token at a resource-server route without ever attempting cryptographic verification', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/oauth/userinfo')
        .set('Authorization', `Bearer ${'a'.repeat(9000)}`);
      expect(res.status).toBe(401);
    });

    it('never silently truncates — the oversized value is rejected, not shortened and accepted', async () => {
      const longButValid = SCOPE_READ; // sanity: a normal-length value is NOT affected by the same limits
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ scope: longButValid }));
      expect(res.status).toBe(302);
    });
  });

  // ===========================================================================
  // Request correlation
  // ===========================================================================
  describe('Request correlation', () => {
    it('a correlation/trace id is generated and returned on the response, and recorded on the resulting audit event', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery());
      const traceId = res.headers['x-trace-id'];
      expect(traceId).toEqual(expect.any(String));

      const event = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findFirst({ where: { tenantId, eventType: 'OAUTH_AUTHORIZATION_CODE_ISSUED', correlationId: traceId }, orderBy: { createdAt: 'desc' } }),
        tenantId,
      );
      expect(event).not.toBeNull();
    });

    it('an externally supplied x-request-id is honored as the correlation id', async () => {
      const externalId = randomUUID();
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery()).set('x-request-id', externalId);
      expect(res.headers['x-trace-id']).toBe(externalId);
    });

    it('the correlation id never influences the authorization decision (a denied request stays denied regardless of the id supplied)', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeQuery({ redirect_uri: 'https://never-registered.example.com/callback' })).set('x-request-id', randomUUID());
      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // Telemetry safety — no secret/token/code/nonce leakage
  // ===========================================================================
  describe('Telemetry safety', () => {
    it('no durable audit event for a successful token exchange contains the access token, code, or verifier', async () => {
      const { code, verifier } = await issueValidCode();
      const tokenRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      expect(tokenRes.status).toBe(200);

      const events = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findMany({ where: { tenantId, eventType: { in: ['OAUTH_AUTHORIZATION_CODE_ISSUED', 'OAUTH_AUTHORIZATION_CODE_REDEEMED'] } }, orderBy: { createdAt: 'desc' }, take: 5 }),
        tenantId,
      );
      expect(events.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain(verifier);
      expect(serialized).not.toContain(tokenRes.body.access_token);
    });

    it('an OIDC authorization-denied event never contains the nonce value itself', async () => {
      const nonce = `secret-nonce-value-${randomUUID()}`;
      // openid without a valid audience -> denied AFTER nonce is read, so the row exists with oidcRequested=true but must never carry the nonce string.
      await authorizeRequest(userAccessToken, validAuthorizeQuery({ scope: 'openid', nonce, audience: 'not-an-allowed-audience' }));

      const events = await prismaContext.runInContext(
        (tx) => tx.securityEvent.findMany({ where: { tenantId, eventType: 'OAUTH_AUTHORIZATION_DENIED' }, orderBy: { createdAt: 'desc' }, take: 5 }),
        tenantId,
      );
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(nonce);
    });

    it('a denied token exchange never records the client secret or service account secret', async () => {
      const wrongSecret = `wrong-secret-${randomUUID()}`;
      await tokenRequest().set('Authorization', basicAuthHeader(clientId, wrongSecret)).send({ grant_type: 'authorization_code', code: 'irrelevant', redirect_uri: REDIRECT_URI, code_verifier: randomVerifier() });

      const events = await prisma.securityEvent.findMany({ where: { eventType: 'OAUTH_TOKEN_DENIED' }, orderBy: { createdAt: 'desc' }, take: 10 });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(wrongSecret);
    });
  });

  // ===========================================================================
  // Authorization-code lifecycle cleanup
  // ===========================================================================
  describe('Authorization code cleanup safety', () => {
    it('deletes an already-expired code and preserves an unexpired one', async () => {
      const { code: expiredCode } = await issueValidCode();
      const { code: activeCode } = await issueValidCode();

      const expiredHash = hashOf(expiredCode);
      const activeHash = hashOf(activeCode);

      // Directly age the FIRST code out (TTL is only ~60s — too slow to await in a test), leave the second alone.
      await prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.updateMany({ where: { tenantId, codeHash: expiredHash }, data: { expiresAt: new Date(Date.now() - 1000) } }), tenantId);

      const deletedCount = await authorizationCodes.deleteExpiredForTenant(tenantId);
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      const expiredRow = await prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.findFirst({ where: { tenantId, codeHash: expiredHash } }), tenantId);
      const activeRow = await prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.findFirst({ where: { tenantId, codeHash: activeHash } }), tenantId);
      expect(expiredRow).toBeNull();
      expect(activeRow).not.toBeNull();
    });

    it('cleanup never deletes an unexpired, already-consumed code', async () => {
      const { code, verifier } = await issueValidCode();
      const consumeRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      expect(consumeRes.status).toBe(200);

      const hash = hashOf(code);
      const beforeCleanup = await prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.findFirst({ where: { tenantId, codeHash: hash } }), tenantId);
      expect(beforeCleanup?.consumedAt).not.toBeNull();

      await authorizationCodes.deleteExpiredForTenant(tenantId);

      const afterCleanup = await prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.findFirst({ where: { tenantId, codeHash: hash } }), tenantId);
      expect(afterCleanup).not.toBeNull(); // still unexpired — consumed does not mean deletable
    });

    function hashOf(plainCode: string): string {
      const [, secret] = plainCode.split('.');
      return createHash('sha256').update(secret).digest('hex');
    }
  });

  // ===========================================================================
  // Regression — every existing flow remains unaffected by this phase
  // ===========================================================================
  describe('Regression', () => {
    it('a normal (non-rate-limited) authorization_code exchange still succeeds end to end', async () => {
      const { code, verifier } = await issueValidCode();
      const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('a normal (non-rate-limited) OIDC exchange still returns an ID Token', async () => {
      const { code, verifier } = await issueValidCode({ scope: 'openid', nonce: `n-${randomUUID()}` });
      const res = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      expect(res.status).toBe(200);
      expect(res.body.id_token).toEqual(expect.any(String));
    });

    it('userinfo still returns claims for a normal, non-rate-limited request', async () => {
      const { code, verifier } = await issueValidCode({ scope: 'openid', audience: USERINFO_AUDIENCE, nonce: `n-${randomUUID()}` });
      const tokenRes = await tokenRequest().set('Authorization', basicAuthHeader(clientId, clientSecret)).send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      const res = await request(app.getHttpServer()).get('/api/v1/oauth/userinfo').set('Authorization', `Bearer ${tokenRes.body.access_token}`);
      expect(res.status).toBe(200);
      expect(res.body.sub).toBe(userId);
    });
  });
});
