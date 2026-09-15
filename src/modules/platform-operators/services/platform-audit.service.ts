import { Injectable } from '@nestjs/common';
import { PaginatedResult } from '../../../common';
import { PrismaService } from '../../../database';
import { PlatformAuditQueryDto } from '../dto/platform-audit-query.dto';

/**
 * Phase 2B.1 — read access to PLATFORM-scope security_event rows only
 * (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Platform audit model"). Plain
 * PrismaService, no PrismaContextService/GUC needed: the RLS policy on
 * security_event (database/ddl/006_platform_operator.sql) makes every
 * scope='PLATFORM' row visible unconditionally through the app connection —
 * gating who may actually call this is PLATFORM_SECURITY_VIEW
 * (PlatformPermissionsGuard), not RLS.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(query: PlatformAuditQueryDto) {
    const where = { scope: 'PLATFORM', ...(query.eventType ? { eventType: query.eventType } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.securityEvent.findMany({ where, skip: query.skip, take: query.take, orderBy: { createdAt: 'desc' } }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return new PaginatedResult(items, total, query);
  }
}
