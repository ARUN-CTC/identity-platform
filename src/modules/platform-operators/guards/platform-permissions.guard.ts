import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PLATFORM_PERMISSIONS_KEY, RequestContextService } from '../../../common';
import { PlatformOperatorsRepository } from '../repositories';

/**
 * Phase 2B.1 — the platform-scope equivalent of PermissionsGuard. Resolves
 * @RequirePlatformPermissions(...) against platform_operator_permission
 * only — never security_user_role, however broad a tenant role might be
 * (Security Invariant #1, docs/adr/ADR-010-platform-operator-security-boundary.md).
 * Runs after PlatformJwtAuthGuard (applied first in each platform
 * controller's @UseGuards list), which populates context.operatorId.
 */
@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly operators: PlatformOperatorsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PLATFORM_PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!requiredPermissions?.length) {
      return true;
    }

    const operatorId = this.context.operatorId;
    if (!operatorId) {
      throw new ForbiddenException('Platform Operator authentication required');
    }

    const codes = await this.operators.listPermissionCodes(operatorId);
    const missing = requiredPermissions.filter((code) => !codes.includes(code));
    if (missing.length > 0) {
      throw new ForbiddenException(`Insufficient platform permissions: missing ${missing.join(', ')}`);
    }

    return true;
  }
}
