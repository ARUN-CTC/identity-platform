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
