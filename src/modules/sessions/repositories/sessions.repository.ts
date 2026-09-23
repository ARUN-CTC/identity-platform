import { Injectable } from '@nestjs/common';
import { SecuritySession } from '@prisma/client';
import { PrismaContextService } from '../../../database';

/**
 * security_session has strict RLS but is written/read during login before
 * RequestContextService has a userId (there's no authenticated caller yet)
 * — every method here takes tenantId explicitly instead of reading it from
 * ambient context.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  async create(
    tenantId: string,
    userId: string,
    expiresAt: Date,
    deviceInfo: string | undefined,
    ipAddress: string | undefined,
    rememberMe = false,
    organizationId?: string | null,
  ): Promise<SecuritySession> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.create({
          data: { tenantId, userId, expiresAt, deviceInfo, ipAddress, rememberMe, organizationId },
        }),
      tenantId,
    );
  }

  async findById(tenantId: string, id: string): Promise<SecuritySession | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securitySession.findFirst({ where: { id, tenantId } }),
      tenantId,
    );
  }

  async findManyForUser(tenantId: string, userId: string): Promise<SecuritySession[]> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.findMany({
          where: { tenantId, userId },
          orderBy: { createdAt: 'desc' },
        }),
      tenantId,
    );
  }

  async touch(tenantId: string, id: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) => tx.securitySession.update({ where: { id }, data: { lastUsedAt: new Date() } }),
      tenantId,
    );
  }

  async revoke(tenantId: string, id: string, reason: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.updateMany({
          where: { id, tenantId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: reason },
        }),
      tenantId,
    );
  }

  async revokeAllForUser(tenantId: string, userId: string, reason: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.updateMany({
          where: { tenantId, userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: reason },
        }),
      tenantId,
    );
  }

  /**
   * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — mutates a
   * session's currently-selected organization IN PLACE. Only valid for a
   * same-tenant context switch (the target organization belongs to the same
   * tenant this session already belongs to) — a cross-tenant switch instead
   * revokes this session and creates a brand-new one under the target
   * tenant, since a security_session row cannot change its own tenant_id
   * (nor should it: tenant_id is the RLS partition key). Pass `null` to
   * clear back to tenant-wide (no organization selected).
   */
  async updateOrganization(tenantId: string, id: string, organizationId: string | null): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) => tx.securitySession.updateMany({ where: { id, tenantId }, data: { organizationId } }),
      tenantId,
    );
  }

  /**
   * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md) — (re)issues
   * the browser-session cookie secret for this session. Called from every
   * path that already touches a session's tokens (login, refresh, both
   * branches of organization-context switch) so the cookie's lifecycle
   * never drifts from the tokens it accompanies.
   */
  async setBrowserSessionSecret(tenantId: string, id: string, secretHash: string, expiresAt: Date): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.updateMany({
          where: { id, tenantId },
          data: { browserSessionSecretHash: secretHash, browserSessionSecretExpiresAt: expiresAt },
        }),
      tenantId,
    );
  }

  /**
   * The one lookup that genuinely cannot take tenantId as an ambient given
   * — a browser presenting only the cookie hasn't told us which tenant it
   * belongs to yet. Safe without an RLS change because the caller (see
   * OAuthBrowserSessionGuard) has already parsed tenantId out of the
   * cookie's own self-identifying value before calling this — this is a
   * normal, tenant-scoped, RLS-respecting query, not a bypass.
   */
  async findByBrowserSessionSecretHash(tenantId: string, secretHash: string): Promise<SecuritySession | null> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.findFirst({
          where: { tenantId, browserSessionSecretHash: secretHash, browserSessionSecretExpiresAt: { gt: new Date() }, revokedAt: null },
        }),
      tenantId,
    );
  }
}
