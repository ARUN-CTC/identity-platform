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
 * Phase 2D.7 acceptance tests — OAuth Authorization Code + PKCE
 * (docs/PHASE_2D7.md, docs/OAUTH_AUTHORIZATION_CODE_PKCE.md). Runs against
 * the real identity_platform_db, same pattern as every prior phase's suite.
 * Exercises the full pipeline: GET /oauth/authorize (behind the existing
 * human JwtAuthGuard session) -> single-use PKCE-bound authorization code ->
 * POST /oauth/token (grant_type=authorization_code) -> RS256 human access
 * token, independently verified via the real JWKS endpoint and — proving
 * Phase 2D.5's resource-server pipeline needed NO changes to accept it — the
 * existing ExternalBearerAuthGuard demo route.
 *
 * grant_type=client_credentials (Phase 2D.4) is also re-exercised here as an
 * explicit regression check (brief §55) — the SAME TokenController now
 * routes both grants.
 */
describe('Phase 2D.7 — OAuth Authorization Code + PKCE (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let issuer: string;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);
  const AUDIENCE = `p2d7-resource-api-${suffix}`;
  const DEMO_AUDIENCE = 'resource-server-demo-api'; // matches ResourceServerDemoController's fixed audience (Phase 2D.5) — proves no change was needed there.
  const PRODUCT_SLUG = `p2d7-${suffix}`;
  const SCOPE_READ = `${PRODUCT_SLUG}.read`;
  const SCOPE_WRITE = `${PRODUCT_SLUG}.write`;
  const REDIRECT_URI = `https://app.example.com/callback-${suffix}`;

  let operatorToken: string;
  let productId: string;
  let productId2: string; // a SECOND, independent product the tenant is NOT entitled to (entitlement-denial test)
  let confidentialClientId: string;
  let confidentialClientSecret: string;
  let confidentialApplicationId: string;
  let publicClientId: string;
  let publicApplicationId: string;
  let unauthorizedCodeApplicationId: string; // registered for client_credentials only, never authorization_code
  let unauthorizedCodeClientId: string;
  let unauthorizedCodeClientSecret: string;

  let tenantId: string;
  let organizationId: string;
  let userAccessToken: string;
  let userId: string;

  // --- fixture helpers -----------------------------------------------------

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

  function decodeClaims(token: string): Record<string, unknown> {
    return jwt.decode(token) as Record<string, unknown>;
  }

  /** RFC 7636 S256: BASE64URL(SHA256(codeVerifier)). */
  function challengeFor(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  function randomVerifier(): string {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''); // 64 chars, valid unreserved-char verifier
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
    organizationId?: string;
    /** Phase 2D.8 addition — only relevant when scope includes openid; unused by every OAuth-only test in this file. */
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
    if (params.organizationId !== undefined) query.organization_id = params.organizationId;
    if (params.nonce !== undefined) query.nonce = params.nonce;
    return request(app.getHttpServer()).get('/api/v1/oauth/authorize').set('Authorization', `Bearer ${token}`).query(query).redirects(0);
  }

  function validAuthorizeParams(overrides: Partial<AuthorizeParams> = {}): AuthorizeParams {
    const verifier = randomVerifier();
    return {
      responseType: 'code',
      clientId: confidentialClientId,
      redirectUri: REDIRECT_URI,
      scope: SCOPE_READ,
      state: `state-${randomUUID()}`,
      codeChallenge: challengeFor(verifier),
      codeChallengeMethod: 'S256',
      audience: AUDIENCE,
      ...overrides,
    };
  }

  /** Runs a full valid /authorize request and returns {code, state, verifier} — the verifier is generated internally so the caller never has to keep the two in sync manually. */
  async function issueValidCode(overrides: Partial<AuthorizeParams> = {}): Promise<{ code: string; state: string; verifier: string; redirectUri: string }> {
    const verifier = randomVerifier();
    const params = validAuthorizeParams({ codeChallenge: challengeFor(verifier), ...overrides });
    const res = await authorizeRequest(userAccessToken, params);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    const code = location.searchParams.get('code');
    expect(code).toEqual(expect.any(String));
    return { code: code!, state: params.state!, verifier, redirectUri: params.redirectUri! };
  }

  function tokenRequest() {
    return request(app.getHttpServer()).post('/api/v1/oauth/token').type('form');
  }

  function basicAuthHeader(id: string, secret: string): string {
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  async function exchangeCode(params: { code: string; redirectUri: string; verifier: string; clientId?: string; useBasicAuth?: boolean }) {
    const req = tokenRequest();
    if (params.useBasicAuth ?? true) {
      req.set('Authorization', basicAuthHeader(confidentialClientId, confidentialClientSecret));
    }
    return req.send({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
      ...(params.clientId ? { client_id: params.clientId } : {}),
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();
    await app.listen(0); // real TCP listener — required for a genuine over-the-network JWKS fetch (the demo resource-server route uses ExternalBearerAuthGuard/JwksClientService, same as tests/phase2d5-resource-server.e2e-spec.ts)

    const address = app.getHttpServer().address() as AddressInfo;
    app.get(JwksClientService).configureJwksUri(`http://127.0.0.1:${address.port}/.well-known/jwks.json`);

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    issuer = app.get(ConfigService).get<string>('OAUTH_ISSUER') ?? 'identity-platform';

    // --- Platform Operator (registers products/applications/entitlements) ---
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

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D7 Product ${suffix}`, slug: PRODUCT_SLUG });
    productId = product.body.id;

    const product2 = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `P2D7 Product2 ${suffix}`, slug: `p2d7-2-${suffix}` });
    productId2 = product2.body.id;

    // --- Confidential Application (authorization_code + PKCE) ---
    const confidentialApp = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D7 Confidential App ${suffix}`,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['authorization_code'],
        allowedScopes: [SCOPE_READ, SCOPE_WRITE, 'openid'],
        audiences: [AUDIENCE, DEMO_AUDIENCE],
        redirectUris: [REDIRECT_URI],
      });
    confidentialApplicationId = confidentialApp.body.id;
    confidentialClientId = confidentialApp.body.clientId;
    confidentialClientSecret = confidentialApp.body.clientSecret;
    expect(confidentialClientSecret).toEqual(expect.any(String));

    // --- Public Application (authorization_code + PKCE, no secret) ---
    const publicApp = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D7 Public App ${suffix}`,
        clientType: 'PUBLIC',
        grantTypes: ['authorization_code'],
        allowedScopes: [SCOPE_READ],
        audiences: [AUDIENCE],
        redirectUris: [REDIRECT_URI],
      });
    publicApplicationId = publicApp.body.id;
    publicClientId = publicApp.body.clientId;
    expect(publicApp.body.clientSecret).toBeNull();

    // --- An Application configured ONLY for client_credentials (never authorization_code) ---
    const ccOnlyApp = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/applications`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: `P2D7 CC-Only App ${suffix}`,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
        allowedScopes: [SCOPE_READ],
        audiences: [AUDIENCE],
      });
    unauthorizedCodeApplicationId = ccOnlyApp.body.id;
    unauthorizedCodeClientId = ccOnlyApp.body.clientId;
    unauthorizedCodeClientSecret = ccOnlyApp.body.clientSecret;

    // --- Tenant, Organization, human User, Membership, Entitlement ---
    tenantId = (await prisma.tenant.create({ data: { tenantCode: `P2D7-${suffix}`, tenantName: 'Phase 2D.7 Tenant', status: 'ACTIVE' } })).id;

    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    organizationId = (
      await prismaContext.runInContext(
        (tx) => tx.organization.create({ data: { tenantId, organizationTypeId: orgType.id, organizationCode: 'ORG-1', organizationName: 'P2D7 Org' } }),
        tenantId,
      )
    ).id;

    const user = await createGlobalUser(`user-${suffix}@example.com`);
    userId = user.id;
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId, userId, status: 'ACTIVE' } }), tenantId);

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/product-entitlements`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ productId });
    // Deliberately NOT entitled to productId2 — used by the entitlement-denial test below.

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantCode: `P2D7-${suffix}`, email: user.email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    userAccessToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Positive end-to-end scenario
  // ===========================================================================
  describe('Positive end-to-end scenario (confidential client)', () => {
    it('authorize -> single-use code -> token exchange -> RS256 human access token, independently verifiable via JWKS', async () => {
      const { code, state, verifier, redirectUri } = await issueValidCode({ organizationId });
      // Never a JWT-shaped authorization code (brief §14) — the opaque value
      // is exactly `base64url(tenantId).secret` (one separator, two parts),
      // structurally distinct from a three-segment JWT.
      expect(code.split('.')).toHaveLength(2);

      const tokenRes = await exchangeCode({ code, redirectUri, verifier });
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.access_token).toEqual(expect.any(String));
      expect(tokenRes.body.token_type).toBe('Bearer');
      expect(tokenRes.body.expires_in).toBeGreaterThan(0);
      expect(tokenRes.body.scope).toBe(SCOPE_READ);
      expect(tokenRes.body).not.toHaveProperty('refresh_token');
      expect(tokenRes.body).not.toHaveProperty('id_token');

      const header = jwt.decode(tokenRes.body.access_token, { complete: true })!.header;
      expect(header.alg).toBe('RS256');

      const jwks = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      const matchingKey = jwks.body.keys.find((k: { kid: string }) => k.kid === header.kid);
      expect(matchingKey).toBeDefined();
      const publicKeyPem = createPublicKey({ key: matchingKey, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
      const verified = jwt.verify(tokenRes.body.access_token, publicKeyPem, { algorithms: ['RS256'], issuer, audience: AUDIENCE }) as jwt.JwtPayload;

      expect(verified.sub).toBe(userId); // the human, never Application.id/ServiceAccount.id
      expect(verified.principal_type).toBe('USER');
      expect(verified.client_id).toBe(confidentialClientId);
      expect(verified.tenant_id).toBe(tenantId);
      expect(verified.organization_id).toBe(organizationId);
      expect(verified.scope).toBe(SCOPE_READ);
      expect(typeof verified.jti).toBe('string');

      expect(state).toEqual(expect.any(String)); // sanity — state round-tripped through issueValidCode's own assertion already
    });

    it('omitting organization_id (no ambient session org context) issues a tenant-wide token — organization_id is absent, never invented', async () => {
      const { code, verifier, redirectUri } = await issueValidCode();
      const tokenRes = await exchangeCode({ code, redirectUri, verifier });
      expect(tokenRes.status).toBe(200);
      const claims = decodeClaims(tokenRes.body.access_token);
      expect(claims.organization_id).toBeUndefined();
      expect(claims.principal_type).toBe('USER');
    });

    it('the SAME code cannot be exchanged twice (single-use / replay protection)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode();

      const first = await exchangeCode({ code, redirectUri, verifier });
      expect(first.status).toBe(200);

      const second = await exchangeCode({ code, redirectUri, verifier });
      expect(second.status).toBe(400);
      expect(second.body.error).toBe('invalid_grant');
    });

    it('a Phase 2D.7 human token flows through the UNCHANGED Phase 2D.5 resource-server pipeline and is correctly distinguished from a ServiceAccount principal', async () => {
      // Phase 2D.8 note: uses SCOPE_READ, not 'openid' — 'openid' now
      // mandatorily requires a `nonce` (docs/OIDC_PROVIDER.md §4), which
      // this OAuth-only (non-OIDC) test has no reason to supply. This test
      // only cares that a Phase 2D.7 human token authenticates correctly at
      // the unmodified resource-server pipeline, not about scope content.
      const { code, verifier, redirectUri } = await issueValidCode({ audience: DEMO_AUDIENCE, scope: SCOPE_READ });
      const tokenRes = await exchangeCode({ code, redirectUri, verifier });
      expect(tokenRes.status).toBe(200);

      const whoami = await request(app.getHttpServer()).get('/api/v1/resource-server/demo/whoami').set('Authorization', `Bearer ${tokenRes.body.access_token}`);
      expect(whoami.status).toBe(200);
      expect(whoami.body.context.principal.type).toBe('USER');
      expect(whoami.body.context.principal.userId).toBe(userId);
      expect(whoami.body.context.principal.serviceAccountId).toBeUndefined();
      expect(whoami.body.context.serviceAccountId).toBeUndefined();
      expect(whoami.body.context.userId).toBe(userId);
      expect(whoami.body.clsMatchesRequest).toBe(true);
    });
  });

  describe('Positive end-to-end scenario (public client)', () => {
    it('a PUBLIC client authorizes and exchanges its code with PKCE alone — no client secret ever presented', async () => {
      const verifier = randomVerifier();
      const params = validAuthorizeParams({ clientId: publicClientId, codeChallenge: challengeFor(verifier) });
      const authRes = await authorizeRequest(userAccessToken, params);
      expect(authRes.status).toBe(302);
      const code = new URL(authRes.headers.location).searchParams.get('code')!;

      const tokenRes = await tokenRequest().send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        client_id: publicClientId,
      });
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.access_token).toEqual(expect.any(String));
    });

    it('a CONFIDENTIAL client cannot skip authentication by presenting only a body client_id (no Basic header)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode();
      const tokenRes = await tokenRequest().send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: confidentialClientId,
      });
      expect(tokenRes.status).toBe(401);
      expect(tokenRes.body.error).toBe('invalid_client');
    });
  });

  // ===========================================================================
  // Authentication requirement — brief §19 originally required a bare 401
  // for an unauthenticated request (no browser session mechanism existed
  // yet). Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md) closes
  // exactly that gap: GET /oauth/authorize now redirects an unauthenticated
  // caller to sign in and resumes the original request afterward, rather
  // than returning a flat 401 a real top-level browser navigation could
  // never recover from. No code is ever issued without authentication
  // either way — only the shape of the "not yet authenticated" response
  // changed. Full behavior now covered by
  // tests/phase2ui5a-oauth-browser-session.e2e-spec.ts; these two remain
  // here as the still-relevant regression check that the OLD bearer-only
  // caller shape this phase originally introduced didn't disappear.
  // ===========================================================================
  describe('Authentication requirement (brief §19, superseded by Phase 2UI.5A)', () => {
    it('an unauthenticated /authorize request is redirected to sign in — never a bare 401, never a code', async () => {
      const params = validAuthorizeParams();
      const query: Record<string, string> = {
        response_type: params.responseType!,
        client_id: params.clientId!,
        redirect_uri: params.redirectUri!,
        scope: params.scope!,
        state: params.state!,
        code_challenge: params.codeChallenge!,
        code_challenge_method: params.codeChallengeMethod!,
        audience: params.audience!,
      };
      const res = await request(app.getHttpServer()).get('/api/v1/oauth/authorize').query(query).redirects(0);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('code')).toBeNull();
    });

    it('an invalid/expired bearer token is treated as unauthenticated (redirected to sign in), not a 401', async () => {
      const res = await authorizeRequest('not-a-real-token', validAuthorizeParams());
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).pathname).toBe('/login');
    });
  });

  // ===========================================================================
  // Client / redirect_uri validation — DIRECT errors, never a redirect (brief §26)
  // ===========================================================================
  describe('Client and redirect_uri validation — never redirected (brief §9/§26)', () => {
    it('missing client_id -> direct 400, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ clientId: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.headers.location).toBeUndefined();
    });

    it('unknown client_id -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ clientId: 'no-such-client' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unauthorized_client');
      expect(res.headers.location).toBeUndefined();
    });

    it('an application configured only for client_credentials -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ clientId: unauthorizedCodeClientId }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unauthorized_client');
      expect(res.headers.location).toBeUndefined();
    });

    it('missing redirect_uri -> direct 400, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ redirectUri: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.headers.location).toBeUndefined();
    });

    it('an unregistered redirect_uri -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ redirectUri: 'https://never-registered.example.com/callback' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.headers.location).toBeUndefined();
    });

    it('a path-suffix attack on an otherwise-registered redirect_uri -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ redirectUri: `${REDIRECT_URI}/evil` }));
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    it('a query-manipulation attack on an otherwise-registered redirect_uri -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ redirectUri: `${REDIRECT_URI}?evil=1` }));
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    it('an open-redirect attempt to an entirely unregistered origin -> direct error, no redirect', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ redirectUri: 'https://evil.example.com/callback' }));
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });
  });

  // ===========================================================================
  // Everything AFTER redirect_uri is validated — delivered as a redirect
  // ===========================================================================
  describe('Post-redirect_uri-validation denials — delivered as a redirect (brief §26)', () => {
    it('missing response_type -> redirect with error=invalid_request', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ responseType: undefined }));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.location);
      expect(loc.origin + loc.pathname).toBe(new URL(REDIRECT_URI).origin + new URL(REDIRECT_URI).pathname);
      expect(loc.searchParams.get('error')).toBe('invalid_request');
    });

    it('response_type=token -> redirect with error=unsupported_response_type (never issues a token via redirect)', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ responseType: 'token' }));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.location);
      expect(loc.searchParams.get('error')).toBe('unsupported_response_type');
      expect(loc.searchParams.get('access_token')).toBeNull();
      expect(loc.hash).toBe(''); // never a fragment-carried token
    });

    it('missing PKCE -> redirect with error=invalid_request', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ codeChallenge: undefined, codeChallengeMethod: undefined }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('code_challenge_method=plain -> redirect with error=invalid_request (plain is never accepted)', async () => {
      const verifier = randomVerifier();
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ codeChallenge: verifier, codeChallengeMethod: 'plain' }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('a malformed code_challenge -> redirect with error=invalid_request', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ codeChallenge: 'too-short' }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('an unregistered/disallowed scope -> redirect with error=invalid_scope', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ scope: 'not-a-registered-scope' }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_scope');
    });

    it('missing audience -> redirect with error=invalid_request', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ audience: undefined }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_request');
    });

    it('a disallowed audience -> redirect with error=invalid_target', async () => {
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ audience: 'not-an-allowed-audience' }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('invalid_target');
    });

    it('state is preserved exactly on both success and denial', async () => {
      const state = `preserve-me-${randomUUID()}`;
      const denied = await authorizeRequest(userAccessToken, validAuthorizeParams({ audience: undefined, state }));
      expect(new URL(denied.headers.location).searchParams.get('state')).toBe(state);

      const params = validAuthorizeParams({ state });
      const issued = await authorizeRequest(userAccessToken, params);
      expect(new URL(issued.headers.location).searchParams.get('state')).toBe(state);
    });

    it('a tenant not entitled to the application\'s product is denied with access_denied, even though the user authenticated successfully', async () => {
      // Reuses productId2 (no entitlement) by pointing a fresh application at
      // it — proves authentication alone never implies product access
      // (brief §37). A NEW application under productId2, still owned by the
      // SAME (entitled-elsewhere) tenant's user.
      const app2 = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId2}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: `P2D7 Product2 App ${suffix}`,
          clientType: 'CONFIDENTIAL',
          grantTypes: ['authorization_code'],
          // 'openid' — a standard OIDC scope, exempt from the per-product
          // namespace requirement (ApplicationScopePolicy) regardless of
          // which product owns this Application; chosen for exactly that
          // portability, not for any OIDC behavior this test cares about.
          allowedScopes: ['openid'],
          audiences: [AUDIENCE],
          redirectUris: [REDIRECT_URI],
        });
      // Phase 2D.8 note: 'openid' now mandatorily requires a `nonce` — supplied here purely to keep this pre-existing scope choice valid; this test itself is otherwise unrelated to OIDC.
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ clientId: app2.body.clientId, scope: 'openid', nonce: `n-${randomUUID()}` }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('access_denied');
    });

    it('an organization_id the user has no membership in is denied with access_denied, never silently ignored or switched to', async () => {
      const foreignOrgTenant = await prisma.tenant.create({ data: { tenantCode: `P2D7-FOREIGN-${suffix}`, tenantName: 'Foreign Tenant', status: 'ACTIVE' } });
      const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
      const foreignOrg = await prismaContext.runInContext(
        (tx) => tx.organization.create({ data: { tenantId: foreignOrgTenant.id, organizationTypeId: orgType.id, organizationCode: 'FOREIGN', organizationName: 'Foreign Org' } }),
        foreignOrgTenant.id,
      );
      const res = await authorizeRequest(userAccessToken, validAuthorizeParams({ organizationId: foreignOrg.id }));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.get('error')).toBe('access_denied');
    });
  });

  // ===========================================================================
  // Token endpoint (grant_type=authorization_code) denial matrix
  // ===========================================================================
  describe('Token endpoint denials (invalid_grant, never distinguished to the caller)', () => {
    it('a wrong PKCE verifier is rejected', async () => {
      const { code, redirectUri } = await issueValidCode();
      const res = await exchangeCode({ code, redirectUri, verifier: randomVerifier() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('a malformed PKCE verifier is rejected', async () => {
      const { code, redirectUri } = await issueValidCode();
      const res = await exchangeCode({ code, redirectUri, verifier: 'too-short' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('a code presented with a DIFFERENT redirect_uri than it was issued for is rejected', async () => {
      const { code, verifier } = await issueValidCode();
      const res = await exchangeCode({ code, redirectUri: 'https://app.example.com/different-callback', verifier });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('a code issued to one client cannot be redeemed by a DIFFERENT client (IDOR — brief §42)', async () => {
      const verifier = randomVerifier();
      const params = validAuthorizeParams({ clientId: publicClientId, codeChallenge: challengeFor(verifier) });
      const authRes = await authorizeRequest(userAccessToken, params);
      const code = new URL(authRes.headers.location).searchParams.get('code')!;

      // Attempt redemption as the CONFIDENTIAL client instead of the PUBLIC client the code was actually issued to.
      const res = await exchangeCode({ code, redirectUri: REDIRECT_URI, verifier });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('an expired code is rejected', async () => {
      const { code, verifier, redirectUri } = await issueValidCode();
      // Directly age the row out via Prisma (TTL is only ~60s — too slow to await in a test). RLS-scoped, like every other direct row mutation in this suite.
      await prismaContext.runInContext(
        (tx) => tx.oAuthAuthorizationCode.updateMany({ where: { redirectUri, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } }),
        tenantId,
      );

      const res = await exchangeCode({ code, redirectUri, verifier });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('a malformed/garbage code is rejected the same generic way as any other invalid grant', async () => {
      const res = await exchangeCode({ code: 'not-a-real-code', redirectUri: REDIRECT_URI, verifier: randomVerifier() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('missing code/redirect_uri/code_verifier -> invalid_request', async () => {
      const res = await tokenRequest().set('Authorization', basicAuthHeader(confidentialClientId, confidentialClientSecret)).send({ grant_type: 'authorization_code' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('exactly one of N concurrent redemption attempts of the SAME code succeeds (brief §18/§41 — replay protection under concurrency)', async () => {
      const { code, verifier, redirectUri } = await issueValidCode();
      const CONCURRENCY = 16;
      const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => exchangeCode({ code, redirectUri, verifier })));
      const successes = results.filter((r) => r.status === 200);
      const failures = results.filter((r) => r.status === 400 && r.body.error === 'invalid_grant');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(CONCURRENCY - 1);
    });
  });

  // ===========================================================================
  // Regression — grant_type=client_credentials (Phase 2D.4) is unchanged
  // ===========================================================================
  describe('Regression — grant_type=client_credentials is unaffected by this phase (brief §55)', () => {
    it('a well-formed client_credentials request still succeeds through the SAME /oauth/token endpoint', async () => {
      // Register a fresh Application/ServiceAccount pair purely for this
      // regression check — proves the newly-added authorization_code
      // routing branch never intercepts a client_credentials request.
      const ccApp = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D7 Regression CC App ${suffix}`, clientType: 'CONFIDENTIAL', grantTypes: ['client_credentials'], allowedScopes: [SCOPE_READ], audiences: [AUDIENCE] });

      const sa = await request(app.getHttpServer())
        .post(`/api/v1/applications/${ccApp.body.id}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `P2D7 Regression SA ${suffix}` });

      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantId}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: sa.body.id });

      const res = await tokenRequest().set('Authorization', basicAuthHeader(ccApp.body.clientId, ccApp.body.clientSecret)).send({
        grant_type: 'client_credentials',
        service_account_id: sa.body.id,
        service_account_secret: sa.body.credential,
        tenant_id: tenantId,
        audience: AUDIENCE,
        scope: SCOPE_READ,
      });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      expect(jwt.decode(res.body.access_token) && (jwt.decode(res.body.access_token) as jwt.JwtPayload).principal_type).toBeUndefined();
    });
  });
});
