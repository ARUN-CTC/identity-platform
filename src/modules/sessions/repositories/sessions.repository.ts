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
  ): Promise<SecuritySession> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securitySession.create({
          data: { tenantId, userId, expiresAt, deviceInfo, ipAddress, rememberMe },
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
}
