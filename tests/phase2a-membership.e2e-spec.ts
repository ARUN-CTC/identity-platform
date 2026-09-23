// Same polyfill main.ts imports before bootstrapping — without it, any
// response containing a BigInt `version` field (every audited entity in
// this schema) crashes Express's JSON serialization. Test.createTestingModule
// never goes through main.ts, so this has to be imported here too.
import '../src/common/bigint-json.polyfill';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common';
import { PrismaContextService, PrismaService } from '../src/database';
import { MailerService } from '../src/modules/mailer/services';
import { UserRolesService } from '../src/modules/users/services';

/**
 * Phase 2A acceptance tests — global Identity + Membership
 * (docs/PHASE_2A.md). Exercises the full authorization/RLS matrix the
 * Phase 2A brief specifies (Steps 18-21): multiple organizations per user,
 * organization-specific roles, membership as the authorization gate,
 * invitation lifecycle, and negative/RLS isolation checks.
 *
 * Runs against the real identity_platform_db (same pattern as
 * health.e2e-spec.ts) — every fixture uses a random suffix so repeated runs
 * never collide with each other or with the DEV bootstrap seed data.
 */
describe('Phase 2A — Global Identity & Membership (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaContext: PrismaContextService;
  let mailer: MailerService;
  let userRolesService: UserRolesService;

  const PASSWORD = 'Test-Passw0rd!1';
  const suffix = randomUUID().slice(0, 8);

  let tenantA: { id: string; tenantCode: string };
  let tenantB: { id: string; tenantCode: string };
  let orgA: { id: string };
  let orgA2: { id: string };
  let orgB: { id: string };
  let orgTypeId: string;
  let tenantAdminRoleId: string;
  let memberRoleId: string;

  async function createGlobalUser(email: string, opts: { withPassword?: boolean } = { withPassword: true }) {
    return prisma.securityUser.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        status: opts.withPassword === false ? 'PROVISIONED' : 'ACTIVE',
        passwordHash: opts.withPassword === false ? null : await hashPassword(PASSWORD),
        passwordChangedAt: opts.withPassword === false ? null : new Date(),
        emailVerifiedAt: new Date(),
      },
    });
  }

  async function addMembership(tenantId: string, organizationId: string, userId: string, status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED' = 'ACTIVE') {
    return prismaContext.runInContext((tx) => tx.membership.create({ data: { tenantId, organizationId, userId, status } }), tenantId);
  }

  async function grantRole(tenantId: string, userId: string, roleId: string, organizationId?: string) {
    return prismaContext.runInContext(
      (tx) => tx.securityUserRole.create({ data: { tenantId, userId, roleId, organizationId } }),
      tenantId,
    );
  }

  async function login(tenantCode: string, email: string, password = PASSWORD): Promise<request.Response> {
    return request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantCode, email, password });
  }

  async function loginOk(tenantCode: string, email: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await login(tenantCode, email);
    expect(res.status).toBe(200); // AuthenticationController.login() sets @HttpCode(OK) explicitly.
    expect(res.body.accessToken).toBeDefined();
    return res.body;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(new ClsMiddleware().use);
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    prismaContext = app.get(PrismaContextService);
    mailer = app.get(MailerService);
    userRolesService = app.get(UserRolesService);

    tenantA = await prisma.tenant.create({
      data: { tenantCode: `P2A-A-${suffix}`, tenantName: 'Phase 2A Tenant A', status: 'ACTIVE' },
    });
    tenantB = await prisma.tenant.create({
      data: { tenantCode: `P2A-B-${suffix}`, tenantName: 'Phase 2A Tenant B', status: 'ACTIVE' },
    });

    const orgType = await prisma.organizationType.findUniqueOrThrow({ where: { typeCode: 'DEFAULT' } });
    orgTypeId = orgType.id;

    orgA = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-A', organizationName: 'Org A' } }),
      tenantA.id,
    );
    orgA2 = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantA.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-A2', organizationName: 'Org A2' } }),
      tenantA.id,
    );
    orgB = await prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { tenantId: tenantB.id, organizationTypeId: orgTypeId, organizationCode: 'ORG-B', organizationName: 'Org B' } }),
      tenantB.id,
    );

    const tenantAdminRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'TENANT_ADMIN', tenantId: null } });
    const memberRole = await prisma.securityRole.findFirstOrThrow({ where: { roleCode: 'MEMBER', tenantId: null } });
    tenantAdminRoleId = tenantAdminRole.id;
    memberRoleId = memberRole.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Scenario 1-3: multiple organizations, organization-specific roles', () => {
    it('User with a tenant-wide ADMIN grant in Org A: login + admin access ALLOWED', async () => {
      const user = await createGlobalUser(`admin-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, user.id, 'ACTIVE');
      await grantRole(tenantA.id, user.id, tenantAdminRoleId); // tenant-wide (organizationId omitted)

      const tokens = await loginOk(tenantA.tenantCode, user.email);
      const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(me.body.roles.map((r: { roleCode: string }) => r.roleCode)).toContain('TENANT_ADMIN');
      expect(me.body.permissions).toContain('USER_MANAGE');

      // Admin-only action (creating a user) is ALLOWED.
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ email: `created-by-admin-${suffix}@example.com`, firstName: 'New', lastName: 'Hire', organizationId: orgA.id });
      expect(createRes.status).toBe(201);
    });

    it('That same user has no membership in Tenant B: login DENIED', async () => {
      const user = await prisma.securityUser.findUniqueOrThrow({ where: { email: `admin-${suffix}@example.com` } });
      const res = await login(tenantB.tenantCode, user.email);
      expect(res.status).toBe(401);
    });

    it('One user, two organizations, different roles: ADMIN in Org A, MEMBER (org-scoped) in Org B — organization-specific role resolution is correct', async () => {
      const user = await createGlobalUser(`multi-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, user.id, 'ACTIVE');
      await grantRole(tenantA.id, user.id, tenantAdminRoleId); // tenant-wide ADMIN in Tenant A
      await addMembership(tenantB.id, orgB.id, user.id, 'ACTIVE');
      await grantRole(tenantB.id, user.id, memberRoleId, orgB.id); // org-scoped MEMBER in Tenant B, Org B only

      // Direct resolution — this is the exact function Phase 2A changed
      // (UserRolesRepository.resolveGrants), so it is tested directly rather
      // than only indirectly through /auth/me, which (a pre-existing Phase 1
      // limitation, not a Phase 2A regression) never resolves organization-
      // scoped grants at all — it only ever asks for tenant-wide grants
      // (see AuthenticationService.getMe()), because Phase 1 never had
      // organization-context switching to know which organization to ask
      // about (docs/ORGANIZATION_CONTEXT.md is Phase 2C's job).
      const grantsInA = await userRolesService.resolveGrants(tenantA.id, user.id);
      expect(grantsInA.roleCodes).toContain('TENANT_ADMIN');
      expect(grantsInA.permissionCodes).toContain('USER_MANAGE');

      // Tenant-wide-only resolution in Tenant B sees nothing — the MEMBER
      // grant is organization-scoped, not tenant-wide.
      const grantsInBTenantWide = await userRolesService.resolveGrants(tenantB.id, user.id);
      expect(grantsInBTenantWide.roleCodes).toEqual([]);

      // Asking specifically about Org B resolves the org-scoped MEMBER grant.
      const grantsInOrgB = await userRolesService.resolveGrants(tenantB.id, user.id, orgB.id);
      expect(grantsInOrgB.roleCodes).toEqual(['MEMBER']);
      expect(grantsInOrgB.permissionCodes).not.toContain('USER_MANAGE');

      // HTTP-level: still authenticated in Tenant B (member-level access —
      // GET /auth/me itself, no permission requirement) — ALLOWED...
      const tokensB = await loginOk(tenantB.tenantCode, user.email);
      const meB = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokensB.accessToken}`);
      expect(meB.status).toBe(200);

      // ...but denied an admin-only action in Tenant B (no tenant-wide grant there).
      const deniedList = await request(app.getHttpServer()).get('/api/v1/users').set('Authorization', `Bearer ${tokensB.accessToken}`);
      expect(deniedList.status).toBe(403);
    });
  });

  describe('Scenario 4-5: removing/suspending a membership revokes access', () => {
    it('Removing a membership denies login to that tenant afterward, and denies an in-flight refresh token', async () => {
      const admin = await createGlobalUser(`remover-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const target = await createGlobalUser(`removable-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, target.id, 'ACTIVE');
      await grantRole(tenantA.id, target.id, memberRoleId, orgA.id);

      const targetTokens = await loginOk(tenantA.tenantCode, target.email);

      const removeRes = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${orgA.id}/members/${target.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ status: 'REMOVED' });
      expect(removeRes.status).toBe(200);

      // Login now denied.
      const loginAfterRemoval = await login(tenantA.tenantCode, target.email);
      expect(loginAfterRemoval.status).toBe(401);

      // The refresh token issued *before* removal must also stop working.
      const refreshAfterRemoval = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: targetTokens.refreshToken });
      expect(refreshAfterRemoval.status).toBe(401);

      // A different, still-ACTIVE membership in the same organization is unaffected.
      const adminMe = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(adminMe.status).toBe(200);
    });

    it('Suspending a membership denies login the same way removal does', async () => {
      const admin = await createGlobalUser(`suspender-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const target = await createGlobalUser(`suspendable-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, target.id, 'ACTIVE');

      const suspendRes = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${orgA.id}/members/${target.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ status: 'SUSPENDED' });
      expect(suspendRes.status).toBe(200);

      const loginRes = await login(tenantA.tenantCode, target.email);
      expect(loginRes.status).toBe(401);
    });
  });

  describe('Invitation lifecycle creates Membership correctly', () => {
    it('inviting a brand-new email creates a global Identity + INVITED membership, and accepting activates both', async () => {
      const admin = await createGlobalUser(`inviter-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const sendSpy = jest.spyOn(mailer, 'send');
      const invitedEmail = `invitee-${suffix}@example.com`;
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ email: invitedEmail, firstName: 'Invited', lastName: 'Person', organizationId: orgA.id });
      expect(createRes.status).toBe(201);

      const invitedUser = await prisma.securityUser.findUniqueOrThrow({ where: { email: invitedEmail } });
      expect(invitedUser.status).toBe('PROVISIONED');
      const membership = await prismaContext.runInContext(
        (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: tenantA.id, organizationId: orgA.id, userId: invitedUser.id } }),
        tenantA.id,
      );
      expect(membership.status).toBe('INVITED');

      // Login before accepting must fail — no password set yet.
      const preAcceptLogin = await login(tenantA.tenantCode, invitedEmail, 'whatever');
      expect(preAcceptLogin.status).toBe(401);

      const inviteCall = sendSpy.mock.calls.find(([msg]) => msg.to === invitedEmail && msg.subject === 'You have been invited');
      expect(inviteCall).toBeDefined();
      const tokenMatch = inviteCall![0].text.match(/token=([^\s&]+)/);
      expect(tokenMatch).not.toBeNull();
      const plainToken = decodeURIComponent(tokenMatch![1]);

      const acceptRes = await request(app.getHttpServer())
        .post('/api/v1/invitations/accept')
        .send({ token: plainToken, password: PASSWORD });
      expect(acceptRes.status).toBe(200); // InvitationsController.accept() sets @HttpCode(OK) explicitly.

      const activatedUser = await prisma.securityUser.findUniqueOrThrow({ where: { email: invitedEmail } });
      expect(activatedUser.status).toBe('ACTIVE');
      const activatedMembership = await prismaContext.runInContext(
        (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: tenantA.id, organizationId: orgA.id, userId: invitedUser.id } }),
        tenantA.id,
      );
      expect(activatedMembership.status).toBe('ACTIVE');

      // Now login succeeds with the password just set.
      const postAcceptLogin = await login(tenantA.tenantCode, invitedEmail);
      expect(postAcceptLogin.status).toBe(200);
    });

    it('inviting an email that already resolves to an active global Identity reuses it (no duplicate account) and skips the accept step', async () => {
      const admin = await createGlobalUser(`inviter2-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      // This Identity already has a password/ACTIVE status via Tenant B.
      const existingEmail = `already-active-${suffix}@example.com`;
      const existingUser = await createGlobalUser(existingEmail);
      await addMembership(tenantB.id, orgB.id, existingUser.id, 'ACTIVE');

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ email: existingEmail, firstName: 'Ignored', lastName: 'Ignored', organizationId: orgA.id });
      expect(createRes.status).toBe(201);

      // Still exactly one security_user row for this email.
      const matches = await prisma.securityUser.findMany({ where: { email: existingEmail } });
      expect(matches).toHaveLength(1);

      const newMembership = await prismaContext.runInContext(
        (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: tenantA.id, organizationId: orgA.id, userId: existingUser.id } }),
        tenantA.id,
      );
      expect(newMembership.status).toBe('ACTIVE'); // no invitation-accept needed — reused the proven Identity directly.

      // The Identity can now log into BOTH tenants with the SAME password.
      const loginA = await login(tenantA.tenantCode, existingEmail);
      expect(loginA.status).toBe(200);
      const loginB = await login(tenantB.tenantCode, existingEmail);
      expect(loginB.status).toBe(200);
    });
  });

  describe('Negative security tests — server-side membership validation cannot be bypassed', () => {
    it('cannot grant an Org A-scoped role to a user whose only membership is in Org A2 (client-supplied organizationId is re-validated server-side)', async () => {
      const admin = await createGlobalUser(`grantor-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      // This user is a real, visible member of the tenant (via Org A2) —
      // deliberately NOT of Org A, the organization the grant targets.
      const otherOrgMember = await createGlobalUser(`other-org-member-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA2.id, otherOrgMember.id, 'ACTIVE');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${otherOrgMember.id}/roles`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ roleId: memberRoleId, organizationId: orgA.id });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no active membership/i);

      // The same grant scoped to the organization they actually belong to succeeds.
      const okRes = await request(app.getHttpServer())
        .post(`/api/v1/users/${otherOrgMember.id}/roles`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ roleId: memberRoleId, organizationId: orgA2.id });
      expect(okRes.status).toBe(201);
    });

    it('a foreign-tenant organizationId 404s rather than leaking cross-tenant access (RLS-scoped existence check)', async () => {
      const admin = await createGlobalUser(`crosstenant-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      // admin is authenticated in Tenant A; orgB belongs to Tenant B.
      const membersRes = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgB.id}/members`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(membersRes.status).toBe(404);

      const createUserRes = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({ email: `nope-${suffix}@example.com`, firstName: 'No', lastName: 'Access', organizationId: orgB.id });
      expect(createUserRes.status).toBe(404);
    });
  });

  describe('RLS isolation at the database level', () => {
    it('a tenant context can only see its own organizations and memberships, never another tenant\'s', async () => {
      const seenFromA = await prismaContext.runInContext((tx) => tx.organization.findMany(), tenantA.id);
      expect(seenFromA.map((o) => o.id)).toEqual(expect.arrayContaining([orgA.id, orgA2.id]));
      expect(seenFromA.map((o) => o.id)).not.toContain(orgB.id);

      const seenFromB = await prismaContext.runInContext((tx) => tx.organization.findMany(), tenantB.id);
      expect(seenFromB.map((o) => o.id)).toContain(orgB.id);
      expect(seenFromB.map((o) => o.id)).not.toEqual(expect.arrayContaining([orgA.id, orgA2.id]));

      const membershipsFromA = await prismaContext.runInContext((tx) => tx.membership.findMany(), tenantA.id);
      expect(membershipsFromA.every((m) => m.tenantId === tenantA.id)).toBe(true);
    });
  });

  describe('Phase 2UI.4: GET /memberships — tenant-wide membership read', () => {
    it("lists memberships across every organization in the caller's tenant, with organization/user identity joined in", async () => {
      const admin = await createGlobalUser(`tw-admin-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const memberInA2 = await createGlobalUser(`tw-member-a2-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA2.id, memberInA2.id, 'ACTIVE');

      const res = await request(app.getHttpServer())
        .get('/api/v1/memberships')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(res.status).toBe(200);
      const items = res.body.items ?? res.body.data ?? res.body;
      const userIds = items.map((m: { user: { id: string } }) => m.user.id);
      // Spans BOTH orgA and orgA2 in one call — the point of the tenant-wide
      // endpoint vs the existing per-organization /organizations/:id/members.
      expect(userIds).toEqual(expect.arrayContaining([admin.id, memberInA2.id]));
      const a2Row = items.find((m: { user: { id: string } }) => m.user.id === memberInA2.id);
      expect(a2Row.organization.id).toBe(orgA2.id);
      expect(a2Row.organization.organizationName).toBe('Org A2');
      // Never a password/credential field on the joined user.
      expect(a2Row.user).not.toHaveProperty('passwordHash');
    });

    it('filters by organizationId, userId, and status', async () => {
      const admin = await createGlobalUser(`tw-filt-admin-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const invited = await createGlobalUser(`tw-filt-invited-${suffix}@example.com`, { withPassword: false });
      await addMembership(tenantA.id, orgA.id, invited.id, 'INVITED');

      const byOrg = await request(app.getHttpServer())
        .get(`/api/v1/memberships?organizationId=${orgA2.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(byOrg.status).toBe(200);
      const byOrgItems = byOrg.body.items ?? byOrg.body.data ?? byOrg.body;
      expect(byOrgItems.every((m: { organization: { id: string } }) => m.organization.id === orgA2.id)).toBe(true);

      const byUser = await request(app.getHttpServer())
        .get(`/api/v1/memberships?userId=${invited.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(byUser.status).toBe(200);
      const byUserItems = byUser.body.items ?? byUser.body.data ?? byUser.body;
      expect(byUserItems).toHaveLength(1);
      expect(byUserItems[0].user.id).toBe(invited.id);

      const byStatus = await request(app.getHttpServer())
        .get('/api/v1/memberships?status=INVITED')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(byStatus.status).toBe(200);
      const byStatusItems = byStatus.body.items ?? byStatus.body.data ?? byStatus.body;
      expect(byStatusItems.every((m: { status: string }) => m.status === 'INVITED')).toBe(true);
      expect(byStatusItems.map((m: { user: { id: string } }) => m.user.id)).toContain(invited.id);
    });

    it('requires USER_VIEW — a member with no tenant-wide grant is denied', async () => {
      const member = await createGlobalUser(`tw-noperm-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, member.id, 'ACTIVE');
      await grantRole(tenantA.id, member.id, memberRoleId, orgA.id); // org-scoped MEMBER only, not tenant-wide
      const memberTokens = await loginOk(tenantA.tenantCode, member.email);

      const res = await request(app.getHttpServer())
        .get('/api/v1/memberships')
        .set('Authorization', `Bearer ${memberTokens.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('is denied entirely without a valid session', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/memberships');
      expect(res.status).toBe(401);
    });

    it("a foreign-tenant organizationId 404s rather than leaking cross-tenant membership rows", async () => {
      const admin = await createGlobalUser(`tw-cross-admin-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/memberships?organizationId=${orgB.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(res.status).toBe(404);
    });

    it("a foreign-tenant userId returns zero rows, not another tenant's membership data (tenantId is always ANDed server-side, never client-controlled)", async () => {
      const admin = await createGlobalUser(`tw-cross-user-admin-${suffix}@example.com`);
      await addMembership(tenantA.id, orgA.id, admin.id, 'ACTIVE');
      await grantRole(tenantA.id, admin.id, tenantAdminRoleId);
      const adminTokens = await loginOk(tenantA.tenantCode, admin.email);

      // A user who exists only in Tenant B.
      const tenantBOnlyUser = await createGlobalUser(`tw-cross-user-victim-${suffix}@example.com`);
      await addMembership(tenantB.id, orgB.id, tenantBOnlyUser.id, 'ACTIVE');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/memberships?userId=${tenantBOnlyUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);
      expect(res.status).toBe(200);
      const items = res.body.items ?? res.body.data ?? res.body;
      expect(items).toEqual([]);
    });
  });
});
