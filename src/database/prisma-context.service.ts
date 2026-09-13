import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context.service';
import { PrismaService } from './prisma.service';

export type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 *
 * Runs `work` inside a short-lived transaction with the caller's tenant/user
 * identity set as Postgres session GUCs (app.current_tenant_id /
 * app.current_user_id — see database/shared/002_functions.sql), so RLS
 * policies and the soft-delete trigger's deleted_by attribution work
 * correctly. The transaction is scoped to just the DB work, not the whole
 * HTTP request, to keep connections short-lived under load.
 */
@Injectable()
export class PrismaContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  /**
   * @param actingAsTenantId Overrides the ambient request context's tenantId
   *   for this call. Needed for pre-authentication flows (login, refresh,
   *   forgot/reset password) where a tenantId is known (parsed from a token,
   *   or resolved from an email+tenantCode) but no RequestContextService
   *   context has been established yet — there is no session to read it
   *   from. userId (for audit attribution) always comes from the caller's
   *   own ambient context, never from this override.
   */
  async runInContext<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
    actingAsTenantId?: string,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const tenantId = actingAsTenantId ?? this.context.tenantId;
      const userId = this.context.userId;

      if (tenantId) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      }
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      return work(tx);
    });
  }
}
