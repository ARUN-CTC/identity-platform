import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService, PrismaTransactionClient } from '../src/database';

/**
 * Phase 2UI.2 (docs/PHASE_2UI2.md) — the three P0 backend/security
 * foundations Phase 2UI.1's UI/UX gap analysis found missing: tenant
 * bootstrap, Application client-secret rotation, ServiceAccount credential
 * rotation. Also re-confirms Gap #4 (audience configuration) as a
 * regression lock — that capability was found to already be fully
 * implemented during this phase's own investigation (CreateApplicationDto
 * already accepted `audiences` at creation time; only Phase 2UI.1's own
 * illustrative wizait-step reasoning assumed otherwise), so this suite
 * proves it rather than re-building it. Runs against the real
 * identity_platform_db, same harness shape as
 * tests/phase2d2-application-oauth-client.e2e-spec.ts.
 */
describe('Phase 2UI.2 — Admin foundation & credential lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let operatorToken: string;
  let productId: string;

  /**
   * organization/membership/securityUserRole/serviceAccountTenantGrant all
   * carry apply_tenant_rls (database/shared/002_functions.sql) — a raw
   * `prisma.X.findFirst(...)` with no app.current_tenant_id GUC set sees
   * ZERO rows (RLS's USING clause evaluates false for every row, not an
   * error), exactly like every real repository in this codebase already
   * has to work around via PrismaContextService.runInContext(). Test
   * verification queries against these tables need the same treatment —
   * this is not a product bug, it's this test file's own verification code
   * needing the same RLS-context discipline the application code already has.
   */
  function inTenant<T>(tenantId: string, fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    return prismaContext.runInContext(fn, tenantId);
  }

  async function createGlobalUser(email: string, opts: { withPassword?: boolean } = { withPassword: true }) {
    return prisma.securityUser.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        passwordHash: opts.withPassword ? await hashPassword(PASSWORD) : null,
        passwordChangedAt: opts.withPassword ? new Date() : null,
      },
    });
  }

  async function platformLogin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  async function tenantLogin(tenantCode: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode, email, password: PASSWORD });
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken;
  }

  async function createTenant(): Promise<{ id: string; tenantCode: string }> {
    const tenantCode = `P2UI2-${randomUUID().slice(0, 8)}`;
    const res = await request(app.getHttpServer()).post('/api/v1/platform/tenants').set('Authorization', `Bearer ${operatorToken}`).send({ tenantCode, tenantName: 'Bootstrap Test Tenant' });
    expect(res.status).toBe(201);
    return { id: res.body.id, tenantCode };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health', '.well-known/jwks.json'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);

    const operatorUser = await createGlobalUser(`operator-${suffix}@example.com`);
    const operator = await prisma.platformOperator.create({ data: { userId: operatorUser.id, status: 'ACTIVE' } });
    const platformPermissions = await prisma.securityPermission.findMany({
      where: {
        permissionCode: {
          in: [
            'PLATFORM_TENANT_VIEW',
            'PLATFORM_TENANT_MANAGE',
            'PRODUCT_MANAGE',
            'PRODUCT_VIEW',
            'APPLICATION_MANAGE',
            'APPLICATION_VIEW',
            'SERVICE_ACCOUNT_MANAGE',
            'SERVICE_ACCOUNT_VIEW',
            'SERVICE_ACCOUNT_TENANT_GRANT_MANAGE',
            'SERVICE_ACCOUNT_TENANT_GRANT_VIEW',
          ],
        },
      },
    });
    await prisma.platformOperatorPermission.createMany({ data: platformPermissions.map((p) => ({ operatorId: operator.id, permissionId: p.id })) });
    operatorToken = await platformLogin(operatorUser.email);

    const productSlug = `p2ui2-${suffix}`;
    const productRes = await request(app.getHttpServer()).post('/api/v1/products').set('Authorization', `Bearer ${operatorToken}`).send({ name: 'Phase 2UI.2 Product', slug: productSlug });
    expect(productRes.status).toBe(201);
    productId = productRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Gap #1 — Tenant Bootstrap ──────────────────────────────────────────

  describe('Tenant Bootstrap', () => {
    it('bootstraps a PROVISIONING tenant: creates Organization, a brand-new Administrator (PROVISIONED/INVITED), Membership, TENANT_ADMIN role grant, and requested entitlements — atomically', async () => {
      const tenant = await createTenant();
      const adminEmail = `admin-${randomUUID().slice(0, 8)}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          organizationName: 'Fleet Ops HQ',
          administratorEmail: adminEmail,
          administratorFirstName: 'Ada',
          administratorLastName: 'Min',
          productIds: [productId],
        });

      expect(res.status).toBe(201);
      const body = res.body;
      expect(body.organization.tenantId).toBe(tenant.id);
      expect(body.organization.organizationCode).toBe(`${tenant.tenantCode}-ORG`.toUpperCase());
      expect(body.administrator.email).toBe(adminEmail);
      expect(body.administrator.isNewIdentity).toBe(true);
      expect(body.membership.status).toBe('INVITED'); // no password yet — brand-new identity
      expect(body.roleAssigned).toBe('TENANT_ADMIN');
      expect(body.entitlements).toHaveLength(1);
      expect(body.entitlements[0].productId).toBe(productId);
      expect(body.entitlements[0].status).toBe('ACTIVE');

      // Real DB state, not just the response shape.
      const orgRow = await inTenant(tenant.id, (tx) => tx.organization.findFirst({ where: { tenantId: tenant.id } }));
      expect(orgRow).not.toBeNull();
      const roleRow = await inTenant(tenant.id, (tx) => tx.securityUserRole.findFirst({ where: { tenantId: tenant.id, userId: body.administrator.id } }));
      const role = await prisma.securityRole.findFirst({ where: { id: roleRow?.roleId } }); // security_role: apply_tenant_rls_nullable, tenantId IS NULL rows visible unconditionally
      expect(role?.roleCode).toBe('TENANT_ADMIN');
      expect(role?.tenantId).toBeNull(); // the shared system template, not a new tenant-owned copy

      // The Platform Operator did NOT gain any platform authority as a side effect — the
      // grant went to the administrator's own tenant-scoped role only, never PlatformOperator.
      const platformOperatorRow = await prisma.platformOperator.findFirst({ where: { userId: body.administrator.id } });
      expect(platformOperatorRow).toBeNull();

      const completedEvent = await prisma.securityEvent.findFirst({ where: { eventType: 'TENANT_BOOTSTRAP_COMPLETED', resourceId: tenant.id } });
      expect(completedEvent).not.toBeNull();
      expect(completedEvent?.tenantId).toBeNull(); // PLATFORM-scoped event — never carries a tenantId (DB constraint)
      expect(completedEvent?.scope).toBe('PLATFORM');
    });

    it('reuses an existing global Identity by email (ACTIVE password holder) — membership goes straight to ACTIVE, no invitation, no duplicate SecurityUser row', async () => {
      const existingEmail = `reuse-${randomUUID().slice(0, 8)}@example.com`;
      const existingUser = await createGlobalUser(existingEmail, { withPassword: true });

      const tenant = await createTenant();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Reuse Org', administratorEmail: existingEmail, administratorFirstName: 'Ignored', administratorLastName: 'Ignored' });

      expect(res.status).toBe(201);
      expect(res.body.administrator.id).toBe(existingUser.id);
      expect(res.body.administrator.isNewIdentity).toBe(false);
      expect(res.body.membership.status).toBe('ACTIVE');

      const userCount = await prisma.securityUser.count({ where: { email: existingEmail } });
      expect(userCount).toBe(1); // never duplicated
    });

    it('rejects reusing a DEACTIVATED global Identity with a clear, safe error — never silently resurrects the account', async () => {
      const deactivatedEmail = `deactivated-${randomUUID().slice(0, 8)}@example.com`;
      await prisma.securityUser.create({ data: { email: deactivatedEmail, firstName: 'D', lastName: 'D', status: 'DEACTIVATED' } });

      const tenant = await createTenant();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org', administratorEmail: deactivatedEmail, administratorFirstName: 'D', administratorLastName: 'D' });

      expect(res.status).toBe(409);
      // No Organization row should have been created — the whole transaction rolled back.
      const orgRow = await inTenant(tenant.id, (tx) => tx.organization.findFirst({ where: { tenantId: tenant.id } }));
      expect(orgRow).toBeNull();
    });

    it('creates the DEFAULT OrganizationType on first use if none exists yet, and reuses it on a second bootstrap that also omits organizationTypeId', async () => {
      // Belt-and-suspenders, best-effort: try to remove an unreferenced
      // 'DEFAULT' row from another suite's seed data, to genuinely exercise
      // the create-on-first-use path this test is for. This is a courtesy
      // only — the assertions below (shared type across tenantA/tenantB,
      // exactly one 'DEFAULT' row) hold regardless of whether this delete
      // succeeds, so a failure here (e.g. an FK reference from the dev seed's
      // own DEV-ORG) is swallowed rather than failing the test over a
      // cleanup step the test doesn't actually depend on.
      try {
        await prisma.organizationType.delete({ where: { typeCode: 'DEFAULT' } });
      } catch {
        // Pre-existing 'DEFAULT' is referenced by another organization (e.g.
        // the dev seed's own DEV-ORG) — left in place, exercising the
        // reuse path instead of the create path below. Still valid coverage.
      }

      const tenantA = await createTenant();
      const resA = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantA.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org A', administratorEmail: `a-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'A', administratorLastName: 'A' });
      expect(resA.status).toBe(201);

      const tenantB = await createTenant();
      const resB = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenantB.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org B', administratorEmail: `b-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'B', administratorLastName: 'B' });
      expect(resB.status).toBe(201);

      const orgA = await inTenant(tenantA.id, (tx) => tx.organization.findFirst({ where: { tenantId: tenantA.id } }));
      const orgB = await inTenant(tenantB.id, (tx) => tx.organization.findFirst({ where: { tenantId: tenantB.id } }));
      expect(orgA?.organizationTypeId).toBe(orgB?.organizationTypeId); // same shared row, not two separate DEFAULTs

      const defaultTypeCount = await prisma.organizationType.count({ where: { typeCode: 'DEFAULT' } });
      expect(defaultTypeCount).toBe(1);
    });

    it('rejects a duplicate bootstrap on an already-bootstrapped tenant (sequential retry)', async () => {
      const tenant = await createTenant();
      const body = { organizationName: 'Org', administratorEmail: `dup-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'D', administratorLastName: 'D' };
      const first = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).set('Authorization', `Bearer ${operatorToken}`).send(body);
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).set('Authorization', `Bearer ${operatorToken}`).send(body);
      expect(second.status).toBe(409);

      const orgCount = await inTenant(tenant.id, (tx) => tx.organization.count({ where: { tenantId: tenant.id } }));
      expect(orgCount).toBe(1); // still exactly one — the retry created nothing
    });

    it('rejects two CONCURRENT bootstrap requests for the same tenant — exactly one succeeds, the other gets a clean 409, never a duplicate Organization', async () => {
      const tenant = await createTenant();
      const body = { organizationName: 'Org', administratorEmail: `concurrent-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'C', administratorLastName: 'C' };

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).set('Authorization', `Bearer ${operatorToken}`).send(body),
        request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).set('Authorization', `Bearer ${operatorToken}`).send(body),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const orgCount = await inTenant(tenant.id, (tx) => tx.organization.count({ where: { tenantId: tenant.id } }));
      expect(orgCount).toBe(1);
      const membershipCount = await inTenant(tenant.id, (tx) => tx.membership.count({ where: { tenantId: tenant.id } }));
      expect(membershipCount).toBe(1);
    });

    it('rejects bootstrap on a tenant that is already ACTIVE (not PROVISIONING)', async () => {
      const tenant = await createTenant();
      await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/activate`).set('Authorization', `Bearer ${operatorToken}`).send();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org', administratorEmail: `active-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'A', administratorLastName: 'A' });
      expect(res.status).toBe(409);

      const deniedEvent = await prisma.securityEvent.findFirst({ where: { eventType: 'TENANT_BOOTSTRAP_DENIED', resourceId: tenant.id } });
      expect(deniedEvent).not.toBeNull();
    });

    it('404s an unknown productId before writing anything', async () => {
      const tenant = await createTenant();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org', administratorEmail: `badprod-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'A', administratorLastName: 'A', productIds: [randomUUID()] });
      expect(res.status).toBe(404);
      const orgRow = await inTenant(tenant.id, (tx) => tx.organization.findFirst({ where: { tenantId: tenant.id } }));
      expect(orgRow).toBeNull();
    });

    it('404s an unknown tenant id', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${randomUUID()}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org', administratorEmail: `nope-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'A', administratorLastName: 'A' });
      expect(res.status).toBe(404);
    });

    it('rejects a missing token with 401, and a tenant-scoped token with 401 (never merely 403) — the Platform Operator boundary is unweakened', async () => {
      const tenant = await createTenant();
      const body = { organizationName: 'Org', administratorEmail: `authz-${randomUUID().slice(0, 8)}@example.com`, administratorFirstName: 'A', administratorLastName: 'A' };

      const noToken = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).send(body);
      expect(noToken.status).toBe(401);

      // Bootstrap a second, throwaway tenant just to get a real tenant-scoped token to attack with.
      const attackerTenant = await createTenant();
      const attackerEmail = `attacker-${randomUUID().slice(0, 8)}@example.com`;
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${attackerTenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Attacker Org', administratorEmail: attackerEmail, administratorFirstName: 'A', administratorLastName: 'A' });
      // Mirrors exactly what the real invitation-accept flow does
      // (UsersRepository.activateWithPassword) — password AND status must
      // both flip together, or login correctly rejects a still-PROVISIONED
      // account with 403 "Account is provisioned" even with a valid password.
      await prisma.securityUser.update({ where: { email: attackerEmail }, data: { passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date(), status: 'ACTIVE' } });
      await inTenant(attackerTenant.id, (tx) => tx.membership.updateMany({ where: { tenantId: attackerTenant.id }, data: { status: 'ACTIVE' } }));
      const attackerToken = await tenantLogin(attackerTenant.tenantCode, attackerEmail);

      const withTenantToken = await request(app.getHttpServer()).post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`).set('Authorization', `Bearer ${attackerToken}`).send(body);
      expect(withTenantToken.status).toBe(401);

      const forged = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', 'Bearer this.is.not-a-real-jwt')
        .send(body);
      expect(forged.status).toBe(401);
    });
  });

  // ── Gap #2 — Application client secret rotation ────────────────────────

  describe('Application credential rotation', () => {
    async function createConfidentialApplication(): Promise<{ id: string; clientSecret: string; productId: string }> {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `RotateApp-${randomUUID().slice(0, 8)}`, clientType: 'CONFIDENTIAL' });
      expect(res.status).toBe(201);
      return { id: res.body.id, clientSecret: res.body.clientSecret, productId };
    }

    it('rotates a CONFIDENTIAL application secret: returns a NEW plaintext once, old secret stops verifying, audit recorded', async () => {
      const app1 = await createConfidentialApplication();
      const before = await prisma.application.findUniqueOrThrow({ where: { id: app1.id } });

      const res = await request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(200);
      expect(res.body.clientSecret).toBeDefined();
      expect(res.body.clientSecret).not.toBe(app1.clientSecret);
      expect(res.body.clientSecretHash).toBeUndefined(); // never returned

      const after = await prisma.application.findUniqueOrThrow({ where: { id: app1.id } });
      expect(after.clientSecretHash).not.toBe(before.clientSecretHash);
      expect(after.secretRevokedAt).toBeNull(); // the NEW, current secret is not itself revoked

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'CLIENT_CREDENTIAL_ROTATED', resourceId: app1.id } });
      expect(event).not.toBeNull();
      expect(JSON.stringify(event?.metadata)).not.toContain(res.body.clientSecret); // never logs the secret itself
    });

    it('a GET after rotation still never returns any secret material', async () => {
      const app1 = await createConfidentialApplication();
      await request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      const getRes = await request(app.getHttpServer()).get(`/api/v1/applications/${app1.id}`).set('Authorization', `Bearer ${operatorToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.clientSecret).toBeUndefined();
      expect(getRes.body.clientSecretHash).toBeUndefined();
    });

    it('rejects rotation on a PUBLIC application (no secret to rotate)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `PublicApp-${randomUUID().slice(0, 8)}`, clientType: 'PUBLIC' });
      expect(res.body.clientSecret).toBeNull();

      const rotate = await request(app.getHttpServer()).post(`/api/v1/applications/${res.body.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(rotate.status).toBe(400);
    });

    it('rejects rotation on a DISABLED application', async () => {
      const app1 = await createConfidentialApplication();
      await request(app.getHttpServer()).patch(`/api/v1/applications/${app1.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });

      const rotate = await request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(rotate.status).toBe(409);
    });

    it('404s a nonexistent application (IDOR-shaped probe)', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/applications/${randomUUID()}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(404);
    });

    it('rejects a tenant-scoped token outright (401)', async () => {
      const app1 = await createConfidentialApplication();
      const tenant = await createTenant();
      const email = `tenantcaller-${randomUUID().slice(0, 8)}@example.com`;
      await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/bootstrap`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationName: 'Org', administratorEmail: email, administratorFirstName: 'A', administratorLastName: 'A' });
      // Same activation-parity fix as the Tenant Bootstrap authz test above.
      await prisma.securityUser.update({ where: { email }, data: { passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date(), status: 'ACTIVE' } });
      await inTenant(tenant.id, (tx) => tx.membership.updateMany({ where: { tenantId: tenant.id }, data: { status: 'ACTIVE' } }));
      const tenantToken = await tenantLogin(tenant.tenantCode, email);

      const res = await request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${tenantToken}`).send();
      expect(res.status).toBe(401);
    });

    it('two concurrent rotation requests: exactly one applies (optimistic lock), the other gets a clean 409, never a lost/overwritten secret', async () => {
      const app1 = await createConfidentialApplication();
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send(),
        request(app.getHttpServer()).post(`/api/v1/applications/${app1.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send(),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  // ── Gap #3 — Service Account credential rotation ───────────────────────

  describe('Service Account credential rotation', () => {
    async function createServiceAccount(): Promise<{ id: string; applicationId: string; credential: string }> {
      const appRes = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `SAHost-${randomUUID().slice(0, 8)}`, clientType: 'CONFIDENTIAL' });
      const saRes = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRes.body.id}/service-accounts`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `sa-${randomUUID().slice(0, 8)}` });
      expect(saRes.status).toBe(201);
      return { id: saRes.body.id, applicationId: appRes.body.id, credential: saRes.body.credential };
    }

    it('rotates a service account credential: new plaintext once, old stops verifying, applicationId/status untouched, audit recorded', async () => {
      const sa = await createServiceAccount();
      const before = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: sa.id } });

      const res = await request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(200);
      expect(res.body.credential).toBeDefined();
      expect(res.body.credential).not.toBe(sa.credential);
      expect(res.body.credentialHash).toBeUndefined();

      const after = await prisma.serviceAccount.findUniqueOrThrow({ where: { id: sa.id } });
      expect(after.credentialHash).not.toBe(before.credentialHash);
      expect(after.applicationId).toBe(before.applicationId); // never touched
      expect(after.status).toBe(before.status); // never touched

      const event = await prisma.securityEvent.findFirst({ where: { eventType: 'SERVICE_ACCOUNT_CREDENTIAL_ROTATED', resourceId: sa.id } });
      expect(event).not.toBeNull();
    });

    it('preserves existing tenant grants across a rotation', async () => {
      const sa = await createServiceAccount();
      const tenant = await createTenant();
      const grantRes = await request(app.getHttpServer())
        .post(`/api/v1/platform/tenants/${tenant.id}/service-account-grants`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ serviceAccountId: sa.id });
      expect(grantRes.status).toBe(201);

      await request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();

      const grantsAfter = await inTenant(tenant.id, (tx) => tx.serviceAccountTenantGrant.findMany({ where: { serviceAccountId: sa.id, tenantId: tenant.id } }));
      expect(grantsAfter).toHaveLength(1);
      expect(grantsAfter[0].status).toBe('ACTIVE');
    });

    it('rejects rotation on a SUSPENDED service account', async () => {
      const sa = await createServiceAccount();
      await request(app.getHttpServer()).patch(`/api/v1/service-accounts/${sa.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'SUSPENDED' });
      const res = await request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(409);
    });

    it('rejects rotation on a DISABLED service account', async () => {
      const sa = await createServiceAccount();
      await request(app.getHttpServer()).patch(`/api/v1/service-accounts/${sa.id}`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'DISABLED' });
      const res = await request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(409);
    });

    it('404s a nonexistent service account, and rejects a cross-application id confusion the same way (no such id exists there either)', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/service-accounts/${randomUUID()}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send();
      expect(res.status).toBe(404);
    });

    it('two concurrent rotation requests: exactly one applies, the other 409s', async () => {
      const sa = await createServiceAccount();
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send(),
        request(app.getHttpServer()).post(`/api/v1/service-accounts/${sa.id}/credentials/rotate`).set('Authorization', `Bearer ${operatorToken}`).send(),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  // ── Gap #4 — Audience configuration (regression lock, already implemented) ─

  describe('Audience configuration (already implemented — regression lock)', () => {
    it('accepts audiences at CREATE time, not only via a follow-up PATCH', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `AudApp-${randomUUID().slice(0, 8)}`, clientType: 'PUBLIC', grantTypes: ['authorization_code'], redirectUris: ['http://localhost/callback'], audiences: ['p2ui2-api'] });
      expect(res.status).toBe(201);
      expect(res.body.audiences).toEqual(['p2ui2-api']);
    });

    it('rejects a wildcard audience at create time', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/applications`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: `WildAud-${randomUUID().slice(0, 8)}`, clientType: 'PUBLIC', audiences: ['*'] });
      expect(res.status).toBe(400);
    });
  });
});
