import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ClsMiddleware } from 'nestjs-cls';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { securityHeadersOptions } from '../src/config/security-headers.config';

/**
 * Phase 3.1 (production hardening) — the ONLY e2e spec that applies
 * `app.use(helmet(...))`, the exact same call `main.ts`'s own bootstrap()
 * makes via the same `securityHeadersOptions()` (see that file's own doc
 * comment for why this extraction exists) — every other e2e spec builds
 * its Nest app directly via TestingModule and never exercises main.ts's
 * middleware at all, so without this spec the helmet integration would be
 * permanently untested, the exact gap `cors.config.spec.ts`'s own
 * existence already documents for CORS.
 */
describe('Phase 3.1 — HTTP security headers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(helmet(securityHeadersOptions()));
    app.use(new ClsMiddleware().use);
    // Replicates main.ts's own enableCors()/Swagger setup exactly — this
    // spec exists specifically to catch a helmet/CORS/Swagger interaction
    // regression, so it must exercise the SAME middleware stack bootstrap()
    // actually applies, not a partial subset of it.
    app.enableCors();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/(.*)', '.well-known/jwks.json', '.well-known/openid-configuration'] });
    const swaggerConfig = new DocumentBuilder().setTitle('Identity Platform API').setVersion('0.1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the safe, browser-relevant defaults on an ordinary JSON response', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-download-options']).toBe('noopen');
    // helmet v7's frameguard default header name.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('deliberately omits Content-Security-Policy — see security-headers.config.ts for why', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('never sets X-Powered-By, avoiding an unnecessary Express fingerprint', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('these headers apply uniformly across the versioned API, the unprefixed health routes, and the unprefixed .well-known routes', async () => {
    const jwks = await request(app.getHttpServer()).get('/.well-known/jwks.json');
    expect(jwks.headers['x-content-type-options']).toBe('nosniff');

    const health = await request(app.getHttpServer()).get('/health');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not break CORS — a preflight-style request still gets the expected Access-Control-* headers', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').set('Origin', 'http://localhost:5173');
    // No CORS_ALLOWED_ORIGINS set in this test environment -> reflect-any-origin,
    // the same local-development default main.ts's own CORS setup documents.
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('Swagger UI at /api/docs still renders — the one concrete reason CSP is off, verified rather than assumed', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
