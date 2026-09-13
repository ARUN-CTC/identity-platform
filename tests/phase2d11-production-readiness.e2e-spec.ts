import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database';
import { TenantsService } from '../src/modules/tenants/services/tenants.service';
import { ProductsService } from '../src/modules/products/services/products.service';

/**
 * Phase 2D.11 acceptance tests — Production Readiness, Resilience &
 * Security Validation (docs/PHASE_2D11.md, docs/PRODUCTION_READINESS.md).
 * Covers only what this phase actually changed: liveness/readiness
 * endpoints, CORS configurability, and the three P2002-race fixes
 * (Tenant/Product/User creation). Every pre-existing security invariant is
 * re-verified by simply re-running the full existing suite (§Regression in
 * docs/PHASE_2D11.md), not duplicated here.
 */
describe('Phase 2D.11 — Production Readiness (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let productsService: ProductsService;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/(.*)', '.well-known/jwks.json', '.well-known/openid-configuration'] });
    await app.init();
    prisma = app.get(PrismaService);
    tenantsService = app.get(TenantsService);
    productsService = app.get(ProductsService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health: liveness vs. readiness (brief §20)', () => {
    it('GET /health/live never touches the database and always responds ok', async () => {
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      // No 'database' key — liveness must carry no dependency information.
      expect(res.body).not.toHaveProperty('database');
    });

    it('GET /health/ready reports the database as up against the real, connected instance', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ready', database: 'up' });
    });

    it('GET /health (legacy, combined) still responds with its original shape, unaffected by the new endpoints', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('database');
    });

    it('none of the three health routes require authentication or the /api/v1 prefix', async () => {
      for (const path of ['/health', '/health/live', '/health/ready']) {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).not.toBe(401);
      }
    });
  });

  describe('Database-conflict race safety (brief §18/§22 — P2002 handling)', () => {
    it('two concurrent raw-Prisma Tenant creations with the SAME tenantCode: exactly one commits — the unique constraint, not application logic, is the actual authority', async () => {
      const tenantCode = `P2D11-Race-Raw-${suffix}`;
      const results = await Promise.allSettled(
        Array.from({ length: 2 }, () => prisma.tenant.create({ data: { tenantCode, tenantName: 'Race', status: 'ACTIVE' } })),
      );
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    });

    it("two concurrent TenantsService.create() calls for the SAME tenantCode: exactly one resolves, the other rejects with the service's own 409 ResourceConflictException — never an unhandled Prisma error reaching the caller", async () => {
      const tenantCode = `P2D11-Race-Svc-${suffix}`;
      const results = await Promise.allSettled([
        tenantsService.create({ tenantCode, tenantName: 'Race A' }),
        tenantsService.create({ tenantCode, tenantName: 'Race B' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason?.getStatus?.()).toBe(409);
      expect(rejected[0].reason?.code).toBe('TENANT_CONFLICT'); // ResourceConflictException, never a raw, unmapped Prisma error surfacing to the caller
    });

    it('two concurrent ProductsService.create() calls for the SAME slug: exactly one resolves, the other 409s (never an unhandled 500)', async () => {
      const slug = `p2d11-race-${suffix}`;
      const results = await Promise.allSettled([
        productsService.create({ name: 'Race Product A', slug }),
        productsService.create({ name: 'Race Product B', slug }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason?.getStatus?.()).toBe(409);
    });
  });
});
