import { Injectable } from '@nestjs/common';
import { SecurityUserInvitationToken } from '@prisma/client';
import { PrismaContextService } from '../../../database';

/** Mirrors PasswordResetTokensRepository — same RLS reasoning (every call takes tenantId explicitly; no authenticated context exists yet during invite/accept). */
@Injectable()
export class InvitationTokensRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  create(data: {
    tenantId: string;
    userId: string;
    organizationId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SecurityUserInvitationToken> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityUserInvitationToken.create({ data }),
      data.tenantId,
    );
  }

  findByHash(tenantId: string, tokenHash: string): Promise<SecurityUserInvitationToken | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityUserInvitationToken.findFirst({ where: { tenantId, tokenHash } }),
      tenantId,
    );
  }

  async markUsed(tenantId: string, id: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) => tx.securityUserInvitationToken.updateMany({ where: { id }, data: { usedAt: new Date() } }),
      tenantId,
    );
  }

  /**
   * Atomically claims a still-valid (unused, unexpired) token by id — the
   * conditional WHERE makes this a compare-and-swap: under two concurrent
   * accept-invitation requests for the same token, at most one UPDATE
   * matches a row, so exactly one caller ever sees count === 1.
   */
  async claim(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prismaContext.runInContext(
      (tx) =>
        tx.securityUserInvitationToken.updateMany({
          where: { id, tenantId, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        }),
      tenantId,
    );
    return result.count === 1;
  }

  /**
   * Invalidates any earlier, still-unused invitation tokens for this user
   * *in this organization* when a new one is issued — only the latest link
   * for a given organization should ever work. Scoped to organizationId
   * (not just tenantId) because Phase 2A allows one global Identity to have
   * more than one pending invitation, into different organizations, at once
   * (docs/PHASE_2A.md).
   */
  async invalidateAllForUser(tenantId: string, userId: string, organizationId: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityUserInvitationToken.updateMany({
          where: { tenantId, userId, organizationId, usedAt: null },
          data: { usedAt: new Date() },
        }),
      tenantId,
    );
  }

  findLatestForUser(tenantId: string, userId: string, organizationId: string): Promise<SecurityUserInvitationToken | null> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securityUserInvitationToken.findFirst({
          where: { tenantId, userId, organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      tenantId,
    );
  }
}
