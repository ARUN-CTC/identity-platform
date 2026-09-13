import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_TENANT_STATUS_CHECK_KEY } from '../decorators/skip-tenant-status-check.decorator';
import { RequestContextService } from '../context/request-context.service';
import { PrismaService } from '../../database';

const BLOCKED_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

/**
 * Business rule: a suspended/cancelled tenant cannot use normal APIs.
 * Registered as a global guard (see RequestContextModule). Phase 1
 * extracted source — copied from TravelOS, classified REUSABLE.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_STATUS_CHECK_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const tenantId = this.context.tenantId;
    if (!tenantId) {
      return true;
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { status: true },
    });
    if (!tenant) {
      return true;
    }

    if (BLOCKED_STATUSES.has(tenant.status)) {
      throw new ForbiddenException(`This tenant is ${tenant.status.toLowerCase()} and cannot access this API`);
    }

    return true;
  }
}
