import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { createHash, createPublicKey, randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { JwksClientService } from '../src/modules/resource-server/services';

/**
 * Phase 2D.8 acceptance tests — OIDC Provider (docs/PHASE_2D8.md,
 * docs/OIDC_PROVIDER.md). Runs against the real identity_platform_db, same
 * pattern as every prior phase's suite. Exercises: the `openid` scope
 * trigger, mandatory nonce, ID Token issuance/claims/audience/client
 * binding, `/userinfo`, discovery, and the OAuth-only/Client-Credentials
 * regression boundaries this phase must not disturb.
 */
describe('Phase 2D.8 — OIDC Provider (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let issuer: string;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const AUDIENCE = `p2d8-resource-api-${suffix}`;
  const USERINFO_AUDIENCE = 'identity-platform-userinfo';
  const DEMO_AUDIENCE = 'resource-server-demo-api'; // Phase 2D.5's fixed demo audience
  const PRODUCT_SLUG = `p2d8-${suffix}`;
  const SCOPE_READ = `${PRODUCT_SLUG}.read`;
  const REDIRECT_URI = `https://app.example.com/callback-${suffix}`;

  let operatorToken: string;
  let productId: string;
  let clientId: string;
  let clientSecret: string;

  let tenantId: string;
  let userAccessToken: string;
  let userId: string;
  let userEmail: string;

  async function createGlobalUser(email: string, overrides: { firstName?: string; lastName?: string; username?: string; emailVerifiedAt?: Date } = {}) {
    return prisma.securityUser.create({
      data: {
        email,
        firstName: overrides.firstName ?? 'Ada',
        lastName: overrides.lastName ?? 'Lovelace',
        username: overrides.username ?? null,
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
        passwordChangedAt: new Date(),
        emailVerifiedAt: overrides.emailVerifiedAt ?? null,
      },
    });
  }

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  function challengeFor(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  function randomVerifier(): string {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  interface AuthorizeParams {
    responseType?: string;
    clientId?: string;
    redirectUri?: string;
    scope?: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    audience?: string;
    nonce?: string;
  }

  function authorizeRequest(token: string, params: AuthorizeParams) {
    const query: Record<string, string> = {};
    if (params.responseType !== undefined) query.response_type = params.responseType;
    if (params.clientId !== undefined) query.client_id = params.clientId;
    if (params.redirectUri !== undefined) query.redirect_uri = params.redirectUri;
    if (params.scope !== undefined) query.scope = params.scope;
    if (params.state !== undefined) query.state = params.state;
    if (params.codeChallenge !== undefined) query.code_challenge = params.codeChallenge;
    if (params.codeChallengeMethod !== undefined) query.code_challenge_method = params.codeChallengeMethod;
    if (params.audience !== undefined) query.audience = params.audience;
    if (params.nonce !== undefined) query.nonce = params.nonce;
    return request(app.getHttpServer()).get('/api/v1/oauth/authorize').set('Authorization', `Bearer ${token}`).query(query).redirects(0);
  }

  function tokenRequest() {
    return request(app.getHttpServer()).post('/api/v1/oauth/token').type('form');
  }

  function basicAuthHeader(id: string, secret: string): string {
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  /** Issues a valid code for the given scope/audience/nonce and returns everything needed to exchange it. */
  async function issueValidCode(overrides: Partial<AuthorizeParams> = {}): Promise<{ code: string; verifier: string; redirectUri: string; nonce?: string }> {
    const verifier = randomVerifier();
    const params: AuthorizeParams = {
      responseType: 'code',
      clientId,
      redirectUri: REDIRECT_URI,
      scope: SCOPE_READ,
      state: `state-${randomUUID()}`,
      codeChallenge: challengeFor(verifier),
      codeChallengeMethod: 'S256',
      audience: AUDIENCE,
      ...overrides,
    };
    const res = await authorizeRequest(userAccessToken, params);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('error')).toBeNull();
    const code = location.searchParams.get('code');
    expect(code).toEqual(expect.any(String));
    return { code: code!, verifier, redirectUri: REDIRECT_URI, nonce: params.nonce };
  }

  async function exchangeCode(params: { code: string; redirectUri: string; verifier: string }) {
    return tokenRequest()
      .set('Authorization', basicAuthHeader(clientId, clientSecret))
      .send({ grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri, code_verifier: params.verifier });
  }

  async function fetchJwks(): Promise<{ keys: Array<Record<string, string>> }> {
    const res = await request(app.getHttpServer()).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    return res.body;
  }

  async function verifyIdToken(token: string, expectedAudience: string): Promise<jwt.JwtPayload> {
    const header = jwt.decode(token, { complete: true })!.header;
    const jwks = await fetchJwks();
    const matchingKey = jwks.keys.find((k) => k.kid === header.kid);
    expect(matchingKey).toBeDefined();
    const publicKeyPem = createPublicKey({ key: matchingKey!, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    return jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer, audience: expectedAudience }) as jwt.JwtPayload;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json', '.well-known/openid-configuration'] });
    await app.init();
    await app.listen(0); // real TCP listener — required for the resource-server-demo cross-check (ExternalBearerAuthGuard/JwksClientService)

    const address = app.getHttpServer().address() as AddressInfo;
    app.get(JwksClientService).configureJwksUri(`http://127.0.0.1:${address.port}/.well-known/jwks.json`);

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    issuer = app.get(ConfigService).get<string>('OAUTH_ISSUER') ?? 'identity-platform';

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: {
        permissionCode: {
          in: ['PRODUCT_MANAGE', 'APPLICATION_MANAGE', 'PRODUCT_ENTITLEMENT_VIEW', 'PRODUCT_ENTITLEMENT_MANAGE', 'SERVICE_ACCOUNT_MANAGE', 'SERVICE_ACCOUNT_TENANT_GRANT_MANAGE'],
        },
      },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    const product = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D8 Product ${suffix}`, slug: PRODUCT_SLUG });
    productId = product.body.id;

    const app1 = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D8 App ${suffix}`,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['authorization_code'],
        allowedScopes: [SCOPE_READ, 'openid', 'profile', 'email'],
        audiences: [AUDIENCE, USERINFO_AUDIENCE, DEMO_AUDIENCE],
        redirectUris: [REDIRECT_URI],
      });
    clientId = app1.body.clientId;
    clientSecret = app1.body.clientSecret;

    tenantId = (await prisma.tenant.create({ data: { tenantCode: `P2D8-${suffix}`, tenantName: 'Phase 2D.8 Tenant', status: 'ACTIVE' } })).id;
    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    const organization = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId, organizationTypeId: orgType.id, organizationCode: 'ORG-1', organizationName: 'P2D8 Org' } }),
      tenantId,
    );

    const user = await createGlobalUser(`user-${suffix}@example.com`, { firstName: 'Ada', lastName: 'Lovelace', username: `ada-${suffix}`, emailVerifiedAt: new Date() });
    userId = user.id;
    userEmail = user.email;
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId: organization.id, userId, status: 'ACTIVE' } }), tenantId);
    await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`).set('Authorization', `Bearer ${operatorToken}`).send({ productId });

    const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: `P2D8-${suffix}`, email: user.email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    userAccessToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // OAuth vs OIDC separation (brief §55 — central test)
  // ===========================================================================
  describe('OAuth vs OIDC separation', () => {
    it('scope=api.read (no openid) — Access Token only, no ID Token, no nonce required', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: SCOPE_READ });
      const res = await exchangeCode({ code, redirectUri, verifier });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('id_token');
    });

    it('scope=openid api.read + nonce — Access Token AND ID Token', async () => {
      const nonce = `nonce-${randomUUID()}`;
      const { code, verifier, redirectUri } = await issueValidCode({ scope: `${SCOPE_READ} openid`, nonce });
      const res = await exchangeCode({ code, redirectUri, verifier });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      expect(res.body.id_token).toEqual(expect.any(String));
    });
  });

  // ===========================================================================
  // Nonce security (brief §8/§9, Invariant 6/7)
  // ===========================================================================
  describe('Nonce security', () => {
    it('an OIDC request (scope includes openid) without nonce is denied', async () => {
      const res = await authorizeRequest(userAccessToken, {
        responseType: 'code',
        clientId,
        redirectUri: REDIRECT_URI,
        scope: 'openid',
        state: 's1',
        codeChallenge: challengeFor(randomVerifier()),
        codeChallengeMethod: 'S256',
        audience: AUDIENCE,
      });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('an ordinary OAuth request (no openid) never requires nonce', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: SCOPE_READ });
      const res = await exchangeCode({ code, redirectUri, verifier });
      expect(res.status).toBe(200);
    });

    it('the ID Token nonce exactly equals the client-supplied nonce, unmodified', async () => {
      const nonce = `exact-nonce-${randomUUID()}`;
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const verified = await verifyIdToken(res.body.id_token, clientId);
      expect(verified.nonce).toBe(nonce);
    });

    it('two independent OIDC transactions never cross-contaminate nonces', async () => {
      const nonceA = `nonce-a-${randomUUID()}`;
      const nonceB = `nonce-b-${randomUUID()}`;
      const a = await issueValidCode({ scope: 'openid', nonce: nonceA });
      const b = await issueValidCode({ scope: 'openid', nonce: nonceB });

      const resA = await exchangeCode(a);
      const resB = await exchangeCode(b);
      const verifiedA = await verifyIdToken(resA.body.id_token, clientId);
      const verifiedB = await verifyIdToken(resB.body.id_token, clientId);

      expect(verifiedA.nonce).toBe(nonceA);
      expect(verifiedB.nonce).toBe(nonceB);
      expect(verifiedA.nonce).not.toBe(verifiedB.nonce);
    });

    it('state and nonce are never conflated — state is not echoed as nonce nor vice versa', async () => {
      const state = `state-value-${randomUUID()}`;
      const nonce = `nonce-value-${randomUUID()}`;
      const verifier = randomVerifier();
      const params: AuthorizeParams = {
        responseType: 'code',
        clientId,
        redirectUri: REDIRECT_URI,
        scope: 'openid',
        state,
        nonce,
        codeChallenge: challengeFor(verifier),
        codeChallengeMethod: 'S256',
        audience: AUDIENCE,
      };
      const authRes = await authorizeRequest(userAccessToken, params);
      expect(authRes.status).toBe(302);
      const location = new URL(authRes.headers.location);
      expect(location.searchParams.get('state')).toBe(state);
      const code = location.searchParams.get('code')!;

      const tokenRes = await exchangeCode({ code, redirectUri: REDIRECT_URI, verifier });
      const verified = await verifyIdToken(tokenRes.body.id_token, clientId);
      expect(verified.nonce).toBe(nonce);
      expect(verified.nonce).not.toBe(state);
      expect(verified).not.toHaveProperty('state');
    });
  });

  // ===========================================================================
  // ID Token claims, audience, client binding (brief §12-18, Invariant 1-3/12)
  // ===========================================================================
  describe('ID Token claims and binding', () => {
    it('ID Token.aud = the OIDC client_id, never the resource-API audience', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: 'n1', audience: AUDIENCE });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const verified = await verifyIdToken(res.body.id_token, clientId);
      expect(verified.aud).toBe(clientId);
      expect(verified.aud).not.toBe(AUDIENCE);

      const accessClaims = jwt.decode(res.body.access_token) as jwt.JwtPayload;
      expect(accessClaims.aud).toBe(AUDIENCE);
      expect(accessClaims.aud).not.toBe(clientId);
    });

    it('ID Token.sub equals the Access Token.sub — the same stable user subject (Invariant 12)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: 'n2' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const idClaims = jwt.decode(res.body.id_token) as jwt.JwtPayload;
      const accessClaims = jwt.decode(res.body.access_token) as jwt.JwtPayload;
      expect(idClaims.sub).toBe(userId);
      expect(idClaims.sub).toBe(accessClaims.sub);
    });

    it('ID Token never carries tenant_id, jti, scope, or client_id (never a blind copy of Access Token claims)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: 'n3' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const idClaims = jwt.decode(res.body.id_token) as jwt.JwtPayload;
      expect(idClaims.tenant_id).toBeUndefined();
      expect(idClaims.jti).toBeUndefined();
      expect(idClaims.scope).toBeUndefined();
      expect(idClaims.client_id).toBeUndefined();
      expect(idClaims.token_use).toBe('id_token');
    });

    it('ID Token is signed RS256, uses a real kid, and is independently verifiable via the live JWKS endpoint (brief §58)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: 'n4' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const header = jwt.decode(res.body.id_token, { complete: true })!.header;
      expect(header.alg).toBe('RS256');
      expect(header.kid).toEqual(expect.any(String));
      const verified = await verifyIdToken(res.body.id_token, clientId);
      expect(verified.iss).toBe(issuer);
    });

    it('no ID Token is issued if the original /authorize request did not request openid, even if profile/email are requested', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: `${SCOPE_READ} profile email` });
      const res = await exchangeCode({ code, redirectUri, verifier });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('id_token');
    });
  });

  // ===========================================================================
  // profile / email scope-gated claims (brief §18/§19/§45, Invariant 13)
  // ===========================================================================
  describe('profile/email scope-gated claims', () => {
    it('openid alone returns only sub — no profile/email claims', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: 'n5' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const claims = jwt.decode(res.body.id_token) as jwt.JwtPayload;
      expect(claims.sub).toBe(userId);
      expect(claims.name).toBeUndefined();
      expect(claims.email).toBeUndefined();
    });

    it('openid+profile returns name/given_name/family_name/preferred_username, never email', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid profile', nonce: 'n6' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const claims = jwt.decode(res.body.id_token) as jwt.JwtPayload;
      expect(claims.name).toBe('Ada Lovelace');
      expect(claims.given_name).toBe('Ada');
      expect(claims.family_name).toBe('Lovelace');
      expect(claims.preferred_username).toEqual(expect.any(String));
      expect(claims.email).toBeUndefined();
    });

    it('openid+email returns email/email_verified, never profile claims', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid email', nonce: 'n7' });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const claims = jwt.decode(res.body.id_token) as jwt.JwtPayload;
      expect(claims.email).toBe(userEmail);
      expect(claims.email_verified).toBe(true); // this fixture user has emailVerifiedAt set
      expect(claims.name).toBeUndefined();
    });

    it('email_verified is never fabricated true for an unverified user (Invariant 13)', async () => {
      const unverified = await createGlobalUser(`unverified-${suffix}@example.com`, { emailVerifiedAt: undefined });
      const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
      const org2 = await prismaContext.runInContext(
        (tx) => tx.organization.create({ data: { tenantId, organizationTypeId: orgType.id, organizationCode: `ORG-UNVER-${suffix}`, organizationName: 'Unverified Org' } }),
        tenantId,
      );
      await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId: org2.id, userId: unverified.id, status: 'ACTIVE' } }), tenantId);
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: `P2D8-${suffix}`, email: unverified.email, password: PASSWORD });
      const unverifiedToken = loginRes.body.accessToken;

      const verifier = randomVerifier();
      const authRes = await authorizeRequest(unverifiedToken, {
        responseType: 'code',
        clientId,
        redirectUri: REDIRECT_URI,
        scope: 'openid email',
        state: 's',
        nonce: 'n-unver',
        codeChallenge: challengeFor(verifier),
        codeChallengeMethod: 'S256',
        audience: AUDIENCE,
      });
      const code = new URL(authRes.headers.location).searchParams.get('code')!;
      const tokenRes = await exchangeCode({ code, redirectUri: REDIRECT_URI, verifier });
      const claims = jwt.decode(tokenRes.body.id_token) as jwt.JwtPayload;
      expect(claims.email_verified).toBe(false);
    });
  });

  // ===========================================================================
  // UserInfo (brief §21-24/§45, Invariant 9)
  // ===========================================================================
  describe('UserInfo', () => {
    async function getUserInfoToken(scope = 'openid'): Promise<string> {
      const { code, verifier, redirectUri } = await issueValidCode({ scope, audience: USERINFO_AUDIENCE, nonce: scope.includes('openid') ? `n-ui-${randomUUID()}` : undefined });
      const res = await exchangeCode({ code, redirectUri, verifier });
      return res.body.access_token;
    }

    function userInfoRequest(token?: string) {
      const req = request(app.getHttpServer()).get('/api/v1/oauth/userinfo');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    }

    it('a valid Access Token (userinfo audience + openid scope) returns sub matching the ID Token/Access Token subject', async () => {
      const token = await getUserInfoToken('openid');
      const res = await userInfoRequest(token);
      expect(res.status).toBe(200);
      expect(res.body.sub).toBe(userId);
    });

    it('missing bearer token is rejected', async () => {
      const res = await userInfoRequest();
      expect(res.status).toBe(401);
    });

    it('a token for the WRONG audience is rejected', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', audience: AUDIENCE, nonce: `n-${randomUUID()}` });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const wrongAudienceToken = res.body.access_token;
      const uiRes = await userInfoRequest(wrongAudienceToken);
      expect(uiRes.status).toBe(401);
    });

    it('a token missing the openid scope (even with the right audience) is rejected with insufficient_scope', async () => {
      const token = await getUserInfoToken(SCOPE_READ);
      const res = await userInfoRequest(token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
    });

    it('an ID Token presented as a bearer credential is rejected (Invariant 9/10)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', audience: USERINFO_AUDIENCE, nonce: `n-${randomUUID()}` });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const idTokenAsBearer = res.body.id_token;
      const uiRes = await userInfoRequest(idTokenAsBearer);
      expect(uiRes.status).toBe(401);
    });

    it('user_id supplied as a query parameter never overrides the authenticated principal (brief §24)', async () => {
      const token = await getUserInfoToken('openid');
      const res = await request(app.getHttpServer()).get('/api/v1/oauth/userinfo').query({ user_id: 'someone-else', tenant_id: 'other-tenant' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.sub).toBe(userId);
    });

    it('respects granted scopes — profile/email claims present only if the token itself carries those scopes', async () => {
      const openidOnly = await getUserInfoToken('openid');
      const openidOnlyRes = await userInfoRequest(openidOnly);
      expect(openidOnlyRes.body).toEqual({ sub: userId });

      const withProfile = await getUserInfoToken('openid profile');
      const withProfileRes = await userInfoRequest(withProfile);
      expect(withProfileRes.body.name).toBe('Ada Lovelace');
      expect(withProfileRes.body.email).toBeUndefined();

      const withEmail = await getUserInfoToken('openid email');
      const withEmailRes = await userInfoRequest(withEmail);
      expect(withEmailRes.body.email).toBe(userEmail);
      expect(withEmailRes.body.name).toBeUndefined();
    });
  });

  // ===========================================================================
  // Resource Server regression (brief §26/§52, Invariant 10/11)
  // ===========================================================================
  describe('Resource Server regression — accepts Access Tokens, rejects ID Tokens', () => {
    it('a USER Access Token is accepted at the existing (unmodified) demo resource-server route', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', audience: DEMO_AUDIENCE, nonce: `n-${randomUUID()}` });
      const res = await exchangeCode({ code, redirectUri, verifier });
      const whoami = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${res.body.access_token}`);
      expect(whoami.status).toBe(200);
      expect(whoami.body.context.principal.type).toBe('USER');
    });

    it('an ID Token is REJECTED at the demo resource-server route, enforced via the explicit token_use claim (Invariant 10)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', audience: DEMO_AUDIENCE, nonce: `n-${randomUUID()}` });
      const tokenRes = await exchangeCode({ code, redirectUri, verifier });
      const idTokenClaims = jwt.decode(tokenRes.body.id_token) as jwt.JwtPayload;
      // The ID Token's own `aud` (the OIDC client's clientId) is NOT the demo
      // audience — so this also proves the rejection holds even though the
      // ID Token was issued in the SAME transaction as an Access Token that
      // DOES carry the demo audience (they are never interchangeable).
      expect(idTokenClaims.aud).toBe(clientId);
      expect(idTokenClaims.aud).not.toBe(DEMO_AUDIENCE);
      expect(idTokenClaims.token_use).toBe('id_token');

      const whoami = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${tokenRes.body.id_token}`);
      expect(whoami.status).toBe(401);
    });

    it('a SERVICE_ACCOUNT Access Token (Client Credentials) is still accepted at the demo resource-server route (regression, brief §52)', async () => {
      const ccApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D8 CC App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [SCOPE_READ], audiences: [DEMO_AUDIENCE] });
      const sa = await request(app.getHttpServer()).post(`/api/v1/applications/${ccApp.body.id}/service-accounts`).set('Authorization', `Bearer ${operatorToken}`).send({ name: `P2D8 SA ${suffix}` });
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`).set('Authorization', `Bearer ${operatorToken}`).send({ serviceAccountId: sa.body.id });

      const ccTokenRes = await tokenRequest().set('Authorization', basicAuthHeader(ccApp.body.clientId, ccApp.body.clientSecret)).send({
        grant_type: 'client_credentials',
        service_account_id: sa.body.id,
        service_account_secret: sa.body.credential,
        tenant_id: tenantId,
        audience: DEMO_AUDIENCE,
      });
      expect(ccTokenRes.status).toBe(200);
      const claims = jwt.decode(ccTokenRes.body.access_token) as jwt.JwtPayload;
      expect(claims.principal_type).toBeUndefined(); // unchanged Phase 2D.4 behavior — never set
      expect(claims.token_use).toBeUndefined(); // unchanged — ClientCredentialsService is untouched by Phase 2D.8

      const whoami = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${ccTokenRes.body.access_token}`);
      expect(whoami.status).toBe(200);
      expect(whoami.body.context.principal.type).toBe('SERVICE_ACCOUNT');
    });
  });

  // ===========================================================================
  // Discovery (brief §35-39/§56)
  // ===========================================================================
  describe('Discovery', () => {
    it('GET /.well-known/openid-configuration returns a complete, accurate document', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/openid-configuration');
      expect(res.status).toBe(200);
      expect(res.body.issuer).toBe(issuer);
      expect(res.body.authorization_endpoint).toBe(`${issuer}/api/v1/oauth/authorize`);
      expect(res.body.token_endpoint).toBe(`${issuer}/api/v1/oauth/token`);
      expect(res.body.userinfo_endpoint).toBe(`${issuer}/api/v1/oauth/userinfo`);
      expect(res.body.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
      expect(res.body.response_types_supported).toEqual(['code']);
      expect(res.body.subject_types_supported).toEqual(['public']);
      expect(res.body.id_token_signing_alg_values_supported).toEqual(['RS256']);
      expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
      expect(res.body.scopes_supported).toEqual(expect.arrayContaining(['openid', 'profile', 'email']));
    });

    it('never advertises unsupported flows/methods', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/openid-configuration');
      expect(res.body.response_types_supported).not.toContain('token');
      expect(res.body.response_types_supported).not.toContain('id_token');
      expect(res.body.code_challenge_methods_supported).not.toContain('plain');
      expect(res.body.grant_types_supported).not.toContain('implicit');
      expect(res.body.grant_types_supported).not.toContain('refresh_token');
      expect(res.body).not.toHaveProperty('registration_endpoint');
      expect(res.body).not.toHaveProperty('revocation_endpoint');
      expect(res.body).not.toHaveProperty('introspection_endpoint');
    });

    it('the discovery endpoint requires no authentication', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/openid-configuration');
      expect(res.status).toBe(200);
    });
  });

  // ===========================================================================
  // JWKS remains public-key-only, unauthenticated, unchanged (Invariant 15)
  // ===========================================================================
  describe('JWKS', () => {
    it('the JWKS response contains no private key material', async () => {
      const jwks = await fetchJwks();
      for (const key of jwks.keys) {
        expect(key).not.toHaveProperty('d');
        expect(key).not.toHaveProperty('p');
        expect(key).not.toHaveProperty('q');
      }
    });
  });

  // ===========================================================================
  // Concurrency / replay — OIDC codes are equally single-use (brief §30/§31)
  // ===========================================================================
  describe('Concurrency', () => {
    it('exactly one of 16 concurrent redemptions of the SAME OIDC code succeeds', async () => {
      const { code, verifier, redirectUri } = await issueValidCode({ scope: 'openid', nonce: `n-${randomUUID()}` });
      const results = await Promise.all(Array.from({ length: 16 }, () => exchangeCode({ code, redirectUri, verifier })));
      const successes = results.filter((r) => r.status === 200);
      expect(successes).toHaveLength(1);
      expect(successes[0].body.id_token).toEqual(expect.any(String));
    });
  });

  // ===========================================================================
  // Regression — PKCE/redirect_uri/client validation still apply to OIDC requests
  // ===========================================================================
  describe('Existing OAuth security controls still apply to OIDC requests', () => {
    it('missing PKCE is still denied for an OIDC (openid) request', async () => {
      const res = await authorizeRequest(userAccessToken, {
        responseType: 'code',
        clientId,
        redirectUri: REDIRECT_URI,
        scope: 'openid',
        state: 's',
        nonce: 'n',
        audience: AUDIENCE,
      });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('an unregistered redirect_uri is still a direct (never redirected) error for an OIDC request', async () => {
      const res = await authorizeRequest(userAccessToken, {
        responseType: 'code',
        clientId,
        redirectUri: 'https://never-registered.example.com/callback',
        scope: 'openid',
        state: 's',
        nonce: 'n',
        codeChallenge: challengeFor(randomVerifier()),
        codeChallengeMethod: 'S256',
        audience: AUDIENCE,
      });
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    it('a wrong PKCE verifier at /token is still rejected for an OIDC code', async () => {
      const { code, redirectUri } = await issueValidCode({ scope: 'openid', nonce: `n-${randomUUID()}` });
      const res = await exchangeCode({ code, redirectUri, verifier: randomVerifier() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });
  });
});
