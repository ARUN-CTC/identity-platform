import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContextService } from '../../../database';

interface RecordEventInput {
  tenantId?: string;
  actorUserId?: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  /**
   * Phase 2B.1 — 'PLATFORM' events must never carry a tenantId (enforced by
   * security_event's own RLS policy, database/ddl/006_platform_operator.sql
   * — a mismatched combination is rejected by the database, not just
   * silently accepted). Defaults to 'TENANT', unchanged behavior for every
   * pre-existing call site. See docs/PLATFORM_OPERATOR_ARCHITECTURE.md,
   * "Platform audit model".
   */
  scope?: 'TENANT' | 'PLATFORM';
}

interface RecordLoginAttemptInput {
  tenantId?: string;
  userId?: string;
  identifier: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * Named security events — distinct from any generic row-diff audit log
 * (not extracted; TravelOS-only). Both security_event and
 * security_login_attempt are append-only: no update/delete methods exist
 * here on purpose.
 */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly prismaContext: PrismaContextService) {}

  async record(input: RecordEventInput): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) => tx.securityEvent.create({ data: input as Prisma.SecurityEventUncheckedCreateInput }),
      input.tenantId,
    );
  }

  /** Convenience wrapper — same as record({...input, scope: 'PLATFORM'}), just harder to accidentally pass a tenantId alongside by mistake. */
  async recordPlatformEvent(input: Omit<RecordEventInput, 'scope' | 'tenantId'>): Promise<void> {
    await this.record({ ...input, scope: 'PLATFORM' });
  }

  async recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityLoginAttempt.create({
          data: input as Prisma.SecurityLoginAttemptUncheckedCreateInput,
        }),
      input.tenantId,
    );
  }
}
