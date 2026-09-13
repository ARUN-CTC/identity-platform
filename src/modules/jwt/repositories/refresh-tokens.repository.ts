import { Injectable } from '@nestjs/common';
import { SecurityRefreshToken } from '@prisma/client';
import { PrismaContextService } from '../../../database';

/**
 * security_refresh_token has strict RLS but is read/written during
 * login/refresh flows before RequestContextService has a userId (there's no
 * authenticated caller yet) — every method here takes tenantId explicitly
 * and passes it as PrismaContextService's actingAsTenantId override.
 */
@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  async create(
    tenantId: string,
    sessionId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<SecurityRefreshToken> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityRefreshToken.create({ data: { tenantId, sessionId, userId, tokenHash, expiresAt } }),
      tenantId,
    );
  }

  async findByHash(tenantId: string, tokenHash: string): Promise<SecurityRefreshToken | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityRefreshToken.findFirst({ where: { tenantId, tokenHash } }),
      tenantId,
    );
  }

  /**
   * Rotation: marks the presented token as rotated/replaced and creates the
   * next one in the chain, in one transaction. replacedById is what lets a
   * later reuse of this same (now-rotated) token be detected.
   */
  async rotate(
    tenantId: string,
    oldTokenId: string,
    sessionId: string,
    userId: string,
    newTokenHash: string,
    newExpiresAt: Date,
  ): Promise<SecurityRefreshToken> {
    return this.prismaContext.runInContext(async (tx) => {
      const next = await tx.securityRefreshToken.create({
        data: { tenantId, sessionId, userId, tokenHash: newTokenHash, expiresAt: newExpiresAt },
      });
      await tx.securityRefreshToken.update({
        where: { id: oldTokenId },
        data: { rotatedAt: new Date(), replacedById: next.id },
      });
      return next;
    }, tenantId);
  }

  async revokeAllForSession(tenantId: string, sessionId: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityRefreshToken.updateMany({
          where: { tenantId, sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      tenantId,
    );
  }

  async revokeAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityRefreshToken.updateMany({
          where: { tenantId, userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      tenantId,
    );
  }
}
