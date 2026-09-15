import { Injectable } from '@nestjs/common';
import { PlatformOperatorRefreshToken, PlatformOperatorSession } from '@prisma/client';
import { PrismaService } from '../../../database';

/**
 * platform_operator_session / platform_operator_refresh_token — structurally
 * mirrors SessionsRepository/RefreshTokensRepository but platform-level (no
 * tenant_id, no RLS — database/ddl/006_platform_operator.sql), so no
 * PrismaContextService/GUC dance is needed anywhere here.
 */
@Injectable()
export class PlatformOperatorSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createSession(operatorId: string, expiresAt: Date, deviceInfo?: string, ipAddress?: string): Promise<PlatformOperatorSession> {
    return this.prisma.platformOperatorSession.create({ data: { operatorId, expiresAt, deviceInfo, ipAddress } });
  }

  findSessionById(id: string): Promise<PlatformOperatorSession | null> {
    return this.prisma.platformOperatorSession.findFirst({ where: { id } });
  }

  findSessionsForOperator(operatorId: string): Promise<PlatformOperatorSession[]> {
    return this.prisma.platformOperatorSession.findMany({ where: { operatorId }, orderBy: { createdAt: 'desc' } });
  }

  async touchSession(id: string): Promise<void> {
    await this.prisma.platformOperatorSession.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  async revokeSession(id: string, reason: string): Promise<void> {
    await this.prisma.platformOperatorSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllSessionsForOperator(operatorId: string, reason: string): Promise<void> {
    await this.prisma.platformOperatorSession.updateMany({ where: { operatorId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  createRefreshToken(sessionId: string, operatorId: string, tokenHash: string, expiresAt: Date): Promise<PlatformOperatorRefreshToken> {
    return this.prisma.platformOperatorRefreshToken.create({ data: { sessionId, operatorId, tokenHash, expiresAt } });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<PlatformOperatorRefreshToken | null> {
    return this.prisma.platformOperatorRefreshToken.findFirst({ where: { tokenHash } });
  }

  async rotateRefreshToken(existingId: string, sessionId: string, operatorId: string, nextTokenHash: string, nextExpiresAt: Date): Promise<void> {
    const next = await this.prisma.platformOperatorRefreshToken.create({
      data: { sessionId, operatorId, tokenHash: nextTokenHash, expiresAt: nextExpiresAt },
    });
    await this.prisma.platformOperatorRefreshToken.update({
      where: { id: existingId },
      data: { rotatedAt: new Date(), replacedById: next.id },
    });
  }

  async revokeAllRefreshTokensForSession(sessionId: string): Promise<void> {
    await this.prisma.platformOperatorRefreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllRefreshTokensForOperator(operatorId: string): Promise<void> {
    await this.prisma.platformOperatorRefreshToken.updateMany({ where: { operatorId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
