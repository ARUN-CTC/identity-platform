import '../src/common/bigint-json.polyfill';

import { createPublicKey, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { TokenService } from '../src/modules/jwt/services';
import { ExternalTokenError } from '../src/modules/oauth/errors';
import { ExternalTokenService, SigningKeyService } from '../src/modules/oauth/services';

/**
 * Phase 2D.1 acceptance tests — the cryptographic foundation and the
 * legacy/external token trust boundary (docs/EXTERNAL_API_TRUST_BOUNDARY.md
 * §0, docs/KEY_MANAGEMENT_ARCHITECTURE.md). Runs against the real
 * identity_platform_db and the real HTTP surface (JWKS is fetched over
 * HTTP, not read via the DI container) — every fixture uses a random
 * suffix so repeated runs never collide.
 */
describe('Phase 2D.1 — External Token Trust Boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let tokenService: TokenService;
  let externalTokenService: ExternalTokenService;
  let signingKeys: SigningKeyService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    tokenService = app.get(TokenService);
    externalTokenService = app.get(ExternalTokenService);
    signingKeys = app.get(SigningKeyService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueRealLegacyToken(): Promise<string> {
    const tenant = await prisma.tenant.create({ data: { tenantCode: `P2D1-${suffix}`, tenantName: 'Phase 2D.1 Tenant', status: 'ACTIVE' } });
    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    const org = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenant.id, organizationTypeId: orgType.id, organizationCode: 'ORG', organizationName: 'Org' } }),
      tenant.id,
    );
    const user = await prisma.securityUser.create({
      data: { email: `p2d1-${suffix}@example.com`, firstName: 'Test', lastName: 'User', status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
    await prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId: tenant.id, organizationId: org.id, userId: user.id, status: 'ACTIVE' } }), tenant.id);

    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode: tenant.tenantCode, email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  describe('JWKS endpoint', () => {
    it('GET /.well-known/jwks.json resolves at the unprefixed, spec-required path and returns valid public-key-only JWKS', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys.length).toBeGreaterThanOrEqual(1);

      const key = res.body.keys[0];
      expect(key.kty).toBe('RSA');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
      expect(typeof key.kid).toBe('string');
      expect(key.kid.length).toBeGreaterThan(0);
      expect(typeof key.n).toBe('string');
      expect(key.e).toBe('AQAB');

      // Private-key material must never appear, anywhere in the response.
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
      for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
        expect(key).not.toHaveProperty(privateField);
      }
    });

    it('is NOT prefixed under /api/v1 — the versioned prefix path 404s', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/.well-known/jwks.json');
      expect(res.status).toBe(404);
    });

    it('requires no authentication (@Public) — no Authorization header needed', async () => {
      const res = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(res.status).toBe(200);
    });
  });

  describe('End-to-end resource-server-style verification using ONLY the public HTTP JWKS surface', () => {
    it('a token signed by ExternalTokenService verifies successfully using nothing but the fetched JWKS public key', async () => {
      const token = externalTokenService.sign({ sub: 'user-abc', scope: 'openid' });
      const decodedHeader = jwt.decode(token, { complete: true }) as { header: { kid: string } };

      const jwksRes = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      const matchingJwk = jwksRes.body.keys.find((k: { kid: string }) => k.kid === decodedHeader.header.kid);
      expect(matchingJwk).toBeDefined();

      // Reconstruct a usable public key PEM from ONLY the published JWK —
      // exactly what an independent resource server would do, with no
      // access to this process's SigningKeyService at all.
      const publicKeyObject = createPublicKey({ key: matchingJwk, format: 'jwk' });
      const publicKeyPem = publicKeyObject.export({ type: 'spki', format: 'pem' }) as string;

      const verified = jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] });
      expect((verified as { sub: string }).sub).toBe('user-abc');
    });
  });

  describe('Legacy (HS256) vs external (RS256) — structural trust-boundary isolation', () => {
    it('a REAL legacy HS256 access token is rejected by ExternalTokenService.verify()', async () => {
      const legacyToken = await issueRealLegacyToken();
      expect(() => externalTokenService.verify(legacyToken)).toThrow(ExternalTokenError);
      try {
        externalTokenService.verify(legacyToken);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_algorithm');
      }
    });

    it('a REAL external RS256 token is rejected by the legacy TokenService.verifyAccessToken()', () => {
      const externalToken = externalTokenService.sign({ sub: 'user-abc' });
      expect(() => tokenService.verifyAccessToken(externalToken)).toThrow();
    });

    it('the legacy verifier explicitly pins algorithms:[HS256] — confirmed by successfully rejecting RS256 even though both token types are signed by the SAME running process', () => {
      // This is the crux of the structural (not merely conventional)
      // separation claim in docs/EXTERNAL_API_TRUST_BOUNDARY.md §0: even
      // though both signers live in the same Node process in this test
      // (unlike production, where an external resource server never even
      // receives JWT_ACCESS_SECRET), the legacy verifier still cannot be
      // tricked into accepting the external token, because it pins its own
      // expected algorithm rather than inferring one from the token.
      const externalToken = externalTokenService.sign({ sub: 'user-abc' });
      let thrown: unknown;
      try {
        tokenService.verifyAccessToken(externalToken);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
    });

    it("an external token's kid always resolves to a key actually published in this process's own JWKS", () => {
      const token = externalTokenService.sign({ sub: 'user-abc' });
      const decodedHeader = jwt.decode(token, { complete: true }) as { header: { kid: string } };
      const jwks = signingKeys.getJwks();
      expect(jwks.keys.some((k) => k.kid === decodedHeader.header.kid)).toBe(true);
    });
  });
});
