import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Membership, Organization, Prisma, SecurityUser, SecurityUserRole, Tenant, TenantProductEntitlement } from '@prisma/client';
import { AppException, RequestContextService, ResourceConflictException, ResourceNotFoundException, deriveOrganizationCode } from '../../../common';
import { PrismaService } from '../../../database';
import { ProductsService } from '../../products/services';
import { SecurityEventsService } from '../../security-audit/services';
import { UserInvitationsService } from '../../users/invitations/services';
import { BootstrapTenantDto } from '../dto';

export interface TenantBootstrapResult {
  tenant: Tenant;
  organization: Organization;
  administrator: { id: string; email: string; isNewIdentity: boolean };
  membership: Membership;
  roleAssigned: string;
  entitlements: TenantProductEntitlement[];
  invitationSent: boolean;
}

const DEFAULT_ORGANIZATION_TYPE_CODE = 'DEFAULT';

/**
 * Phase 2UI.2 (docs/TENANT_BOOTSTRAP.md) — the missing piece between
 * `POST /platform/tenants` (creates only the `tenant` row — see
 * TenantsService.create()'s own comment) and a tenant actually being
 * usable. A Platform Operator has no tenant JWT and no ambient
 * RequestContextService.tenantId, so none of the ordinary
 * OrganizationsRepository/UsersService/MembershipsService/UserRolesService
 * methods (every one of them reads `this.context.requireTenantId()`) can
 * be called here — this service writes directly against a single shared
 * Prisma transaction client instead, matching each of those repositories'
 * own `data:` shape exactly (verified by reading every one of them) so the
 * resulting rows are indistinguishable from what the ordinary flow
 * produces. This is a deliberate, narrow exception to "reuse existing
 * repositories" — the alternative (threading an optional external
 * transaction client through five services across four modules) was
 * judged a disproportionately large, cross-cutting change for what this
 * phase needs; the data CONTRACT is reused exactly, even though the
 * function calls are not.
 *
 * Atomicity boundary, stated precisely: the DB state (Tenant readback,
 * Organization, SecurityUser, Membership, SecurityUserRole,
 * TenantProductEntitlement rows, and the completion audit event) is one
 * Postgres transaction — genuinely atomic, real ROLLBACK on any failure.
 * The invitation EMAIL is deliberately sent AFTER that transaction commits,
 * never inside it — holding a DB transaction open across an SMTP call is
 * an anti-pattern this codebase doesn't have anywhere else either (see
 * UserInvitationsService.issueAndSend, which interleaves DB writes and
 * mailer.send using its own short-lived, independently-committed
 * transactions). A failed email send after a successful bootstrap leaves
 * the tenant/organization/administrator/membership state fully valid and
 * correct — recoverable via the existing, unmodified "resend invitation"
 * endpoint — never an orphaned identity/tenant/org relationship, which is
 * the actual "no orphaned state" guarantee this phase's brief asks for.
 */
@Injectable()
export class TenantBootstrapService {
  private readonly logger = new Logger(TenantBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly securityEvents: SecurityEventsService,
    private readonly invitations: UserInvitationsService,
    private readonly context: RequestContextService,
  ) {}

  /**
   * actorUserId comes from RequestContextService (PlatformJwtAuthGuard
   * populates it for a Platform Operator too — same as every other
   * platform service in this codebase, e.g.
   * TenantProductEntitlementsService/ApplicationsService), never as an
   * explicit parameter — keeping this service's own public signature
   * consistent with its siblings.
   */
  async bootstrap(tenantId: string, dto: BootstrapTenantDto): Promise<TenantBootstrapResult> {
    const actorUserId = this.context.userId!;
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) {
      throw new ResourceNotFoundException('Tenant', tenantId);
    }

    // Idempotency pre-check (a courtesy — the real, concurrency-safe guarantee
    // is uk_org_code inside the transaction below, exactly the same
    // pre-check-then-constraint pattern TenantsService.create()/
    // TenantProductEntitlementsService.create() already use for their own
    // duplicate protection).
    if (tenant.status !== 'PROVISIONING') {
      await this.denyBootstrap(tenantId, actorUserId, `Tenant is not in PROVISIONING status (currently ${tenant.status}) — already bootstrapped or otherwise ineligible`);
    }
    const existingOrg = await this.prisma.organization.findFirst({ where: { tenantId } });
    if (existingOrg) {
      await this.denyBootstrap(tenantId, actorUserId, 'Tenant already has at least one Organization — bootstrap has already run');
    }

    // Product validation happens before the transaction opens — same
    // existence-only check TenantProductEntitlementsService.create() itself
    // applies (no additional ACTIVE-status gate at grant time; see
    // docs/TENANT_BOOTSTRAP.md for why bootstrap deliberately matches that
    // existing behavior rather than inventing a stricter rule of its own).
    const productIds = [...new Set(dto.productIds ?? [])];
    for (const productId of productIds) {
      await this.productsService.findOne(productId); // 404s an unknown product before any write
    }

    const organizationCode = dto.organizationCode ?? deriveOrganizationCode(tenant.tenantCode);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actorUserId}, true)`;

        const orgType = await this.resolveOrCreateOrganizationType(tx, dto.organizationTypeId, actorUserId);

        let organization: Organization;
        try {
          organization = await tx.organization.create({
            data: {
              tenantId,
              organizationTypeId: orgType.id,
              organizationCode,
              organizationName: dto.organizationName,
              status: 'ACTIVE',
              createdBy: actorUserId,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            // The real concurrency guard: two simultaneous bootstrap calls
            // for the same tenant both pass the pre-checks above, but only
            // one INSERT into uk_org_code (tenant_id, organization_code)
            // ever succeeds — the loser lands here, cleanly, every time.
            throw new ResourceConflictException('Tenant', 'This tenant has already been bootstrapped (concurrent request)');
          }
          throw err;
        }

        let administrator = await tx.securityUser.findFirst({ where: { email: dto.administratorEmail } });
        const isNewIdentity = !administrator;
        if (administrator && administrator.status === 'DEACTIVATED') {
          throw new AppException(
            'IAM_ADMINISTRATOR_ACCOUNT_DEACTIVATED',
            'An account for this email already exists but is deactivated — reactivate it first, or use a different email',
            HttpStatus.CONFLICT,
          );
        }
        if (!administrator) {
          administrator = await tx.securityUser.create({
            data: {
              email: dto.administratorEmail,
              firstName: dto.administratorFirstName,
              lastName: dto.administratorLastName,
              createdBy: actorUserId,
            },
          });
        }

        // Same status-derived branch UsersService.createInternal() already
        // uses: a proven existing identity (has a password) goes straight
        // to ACTIVE, a brand-new or still-mid-setup identity is INVITED.
        const membershipStatus: 'ACTIVE' | 'INVITED' = administrator.passwordHash ? 'ACTIVE' : 'INVITED';
        const membership = await tx.membership.create({
          data: { tenantId, organizationId: organization.id, userId: administrator.id, status: membershipStatus, createdBy: actorUserId },
        });

        const tenantAdminRole = await tx.securityRole.findFirst({ where: { roleCode: 'TENANT_ADMIN', tenantId: null, deletedAt: null } });
        if (!tenantAdminRole) {
          // Defensive only — TENANT_ADMIN is a seeded system role
          // (database/seeds/002_system_roles.sql); its absence means the
          // platform's own reference data was never seeded, not a caller
          // error.
          throw new AppException('IAM_SYSTEM_ROLE_MISSING', "The system 'TENANT_ADMIN' role is not seeded on this platform", HttpStatus.INTERNAL_SERVER_ERROR);
        }
        const roleGrant: SecurityUserRole = await tx.securityUserRole.create({
          data: { tenantId, userId: administrator.id, roleId: tenantAdminRole.id, organizationId: null, createdBy: actorUserId },
        });

        const entitlements: TenantProductEntitlement[] = [];
        for (const productId of productIds) {
          try {
            entitlements.push(await tx.tenantProductEntitlement.create({ data: { tenantId, productId, createdBy: actorUserId } }));
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              throw new AppException('IAM_DUPLICATE_PRODUCT_ENTITLEMENT', `productIds contains duplicate/conflicting entries for product ${productId}`, HttpStatus.BAD_REQUEST);
            }
            throw err;
          }
        }

        await tx.securityEvent.create({
          data: {
            tenantId: null,
            scope: 'PLATFORM',
            actorUserId,
            eventType: 'TENANT_BOOTSTRAP_COMPLETED',
            resourceType: 'Tenant',
            resourceId: tenantId,
            metadata: {
              tenantCode: tenant.tenantCode,
              organizationId: organization.id,
              administratorUserId: administrator.id,
              administratorIsNewIdentity: isNewIdentity,
              membershipStatus,
              roleAssigned: 'TENANT_ADMIN',
              productIds,
            },
          } as Prisma.SecurityEventUncheckedCreateInput,
        });

        return { tenant, organization, administrator, isNewIdentity, membership, roleGrant, entitlements, membershipStatus };
      });

      const invitationSent = await this.sendPostCommitNotification(result.tenant.id, actorUserId, result.administrator, result.organization.id, result.membershipStatus);

      return {
        tenant: result.tenant,
        organization: result.organization,
        administrator: { id: result.administrator.id, email: result.administrator.email, isNewIdentity: result.isNewIdentity },
        membership: result.membership,
        roleAssigned: 'TENANT_ADMIN',
        entitlements: result.entitlements,
        invitationSent,
      };
    } catch (err) {
      await this.recordFailure(tenantId, actorUserId, err);
      throw err;
    }
  }

  private async resolveOrCreateOrganizationType(tx: Prisma.TransactionClient, organizationTypeId: string | undefined, actorUserId: string) {
    if (organizationTypeId) {
      const found = await tx.organizationType.findFirst({ where: { id: organizationTypeId, deletedAt: null } });
      if (!found) {
        throw new ResourceNotFoundException('OrganizationType', organizationTypeId);
      }
      return found;
    }
    // OrganizationType has no tenant_id column at all (schema-confirmed) —
    // genuinely global reference data. A clean install has no seeded row
    // yet (the only place 'DEFAULT' is seeded today is the DEV-only
    // database/seeds/003_bootstrap_dev_tenant.sql, never run in
    // production), so bootstrap creates it on first use rather than
    // assuming it exists — the same find-or-create discipline
    // UsersService.createInternal() already applies to a global
    // SecurityUser by email, extended here to a global OrganizationType by
    // typeCode.
    const existing = await tx.organizationType.findFirst({ where: { typeCode: DEFAULT_ORGANIZATION_TYPE_CODE, deletedAt: null } });
    if (existing) {
      return existing;
    }
    return tx.organizationType.create({
      data: { typeCode: DEFAULT_ORGANIZATION_TYPE_CODE, typeName: 'Default Organization Type', isActive: true, createdBy: actorUserId },
    });
  }

  private async sendPostCommitNotification(
    tenantId: string,
    actorUserId: string,
    administrator: SecurityUser,
    organizationId: string,
    membershipStatus: 'ACTIVE' | 'INVITED',
  ): Promise<boolean> {
    try {
      if (membershipStatus === 'INVITED') {
        await this.invitations.sendInvitation(tenantId, actorUserId, administrator, organizationId);
      } else {
        await this.invitations.notifyAddedToOrganization(administrator);
      }
      return true;
    } catch (err) {
      // The core bootstrap state already committed successfully — a
      // failed email is a delivery hiccup, not an orphaned identity.
      // Recoverable via the existing, unmodified resend-invitation
      // endpoint. Never fail the whole bootstrap response over this.
      this.logger.warn(`Tenant bootstrap for ${tenantId} succeeded, but the administrator notification failed to send: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async denyBootstrap(tenantId: string, actorUserId: string, reason: string): Promise<never> {
    await this.securityEvents.recordPlatformEvent({
      actorUserId,
      eventType: 'TENANT_BOOTSTRAP_DENIED',
      resourceType: 'Tenant',
      resourceId: tenantId,
      metadata: { reason },
    });
    throw new ResourceConflictException('Tenant', reason);
  }

  private async recordFailure(tenantId: string, actorUserId: string, err: unknown): Promise<void> {
    try {
      await this.securityEvents.recordPlatformEvent({
        actorUserId,
        eventType: 'TENANT_BOOTSTRAP_FAILED',
        resourceType: 'Tenant',
        resourceId: tenantId,
        // A coarse category only — never the raw error message, which could
        // incidentally include a value from the request. This mirrors the
        // rest of this codebase's own "never leak internal detail into
        // audit metadata" discipline.
        metadata: { errorType: err instanceof AppException ? err.constructor.name : 'UnexpectedError' },
      });
    } catch (auditErr) {
      this.logger.error(`Failed to record TENANT_BOOTSTRAP_FAILED audit event for tenant ${tenantId}: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
    }
  }
}
