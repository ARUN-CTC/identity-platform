import { Injectable } from '@nestjs/common';
import { Prisma, SecurityEvent, SecurityLoginAttempt } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';
import { LoginAttemptQueryDto } from '../dto/login-attempt-query.dto';
import { SecurityEventQueryDto } from '../dto/security-event-query.dto';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * Read-only query side of the audit trail (SecurityEventsService owns the
 * writes). Both tables carry a nullable tenant_id — queries filter
 * explicitly to `tenantId = this tenant` rather than relying on
 * apply_tenant_rls_nullable()'s default "tenant rows + NULL rows"
 * visibility, so a tenant admin only ever sees their own tenant's history.
 */
@Injectable()
export class SecurityAuditRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findLoginAttempts(
    query: LoginAttemptQueryDto,
  ): Promise<{ items: SecurityLoginAttempt[]; total: number }> {
    const tenantId = this.context.requireTenantId();
    const where: Prisma.SecurityLoginAttemptWhereInput = {
      tenantId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.success !== undefined ? { success: query.success === 'true' } : {}),
      ...(query.identifier
        ? { identifier: { contains: query.identifier, mode: 'insensitive' } }
        : {}),
    };

    return this.prismaContext.runInContext(async (tx) => {
      const [items, total] = await Promise.all([
        tx.securityLoginAttempt.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: { createdAt: 'desc' },
        }),
        tx.securityLoginAttempt.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }

  async findEvents(query: SecurityEventQueryDto): Promise<{ items: SecurityEvent[]; total: number }> {
    const tenantId = this.context.requireTenantId();
    const where: Prisma.SecurityEventWhereInput = {
      tenantId,
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
    };

    return this.prismaContext.runInContext(async (tx) => {
      const [items, total] = await Promise.all([
        tx.securityEvent.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: { createdAt: 'desc' },
        }),
        tx.securityEvent.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }
}
