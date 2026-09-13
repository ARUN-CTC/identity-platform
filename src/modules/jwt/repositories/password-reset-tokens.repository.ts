import { Injectable } from '@nestjs/common';
import { SecurityPasswordResetToken } from '@prisma/client';
import { PrismaContextService } from '../../../database';

/** Mirrors RefreshTokensRepository — same RLS reasoning (every call takes tenantId explicitly; no authenticated context exists yet during forgot/reset). */
@Injectable()
export class PasswordResetTokensRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  async create(tenantId: string, userId: string, tokenHash: string, expiresAt: Date): Promise<SecurityPasswordResetToken> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityPasswordResetToken.create({ data: { tenantId, userId, tokenHash, expiresAt } }),
      tenantId,
    );
  }

  async findByHash(tenantId: string, tokenHash: string): Promise<SecurityPasswordResetToken | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityPasswordResetToken.findFirst({ where: { tenantId, tokenHash } }),
      tenantId,
    );
  }

  /**
   * updateMany (not update) despite id already being unique — a plain
   * .update({where:{id}}) under RLS throws P2025 rather than matching the
   * row if the acting tenant context is ever wrong, instead of the
   * .updateMany() 0-rows-affected outcome this code already checks for
   * everywhere else.
   */
  async markUsed(tenantId: string, id: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) => tx.securityPasswordResetToken.updateMany({ where: { id, tenantId }, data: { usedAt: new Date() } }),
      tenantId,
    );
  }

  /** Invalidates any earlier, still-unused reset tokens for this user when a new one is requested — only the latest link should ever work. */
  async invalidateAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityPasswordResetToken.updateMany({
          where: { tenantId, userId, usedAt: null },
          data: { usedAt: new Date() },
        }),
      tenantId,
    );
  }
}
