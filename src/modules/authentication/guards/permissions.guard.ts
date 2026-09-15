import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY, REQUIRE_ROLES_KEY, RequestContextService } from '../../../common';
import { UserRolesService } from '../../users/services';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 *
 * Global authorization guard (RBAC) — runs after JwtAuthGuard/TenantStatusGuard
 * so context.tenantId/userId are already set. Routes with neither
 * @RequirePermissions nor @RequireRoles are unrestricted beyond
 * authentication itself. @RequirePermissions codes are AND'd; @RequireRoles
 * codes are OR'd.
 *
 * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md): now resolves grants
 * against the caller's currently SELECTED organization
 * (context.organizationId), not tenant-wide grants only — this is what
 * makes an organization-scoped role grant actually apply once a user has
 * selected that organization as their active context ("Organization Role
 * Resolution": authorization resolves against Current User + Current
 * Organization, never "any organization the user happens to belong to").
 * resolveGrants() itself re-validates Membership and Organization status
 * live on every call — a stale/revoked context never survives this check,
 * regardless of what the presented token's own claim says.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly userRolesService: UserRolesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRE_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!requiredPermissions?.length && !requiredRoles?.length) {
      return true;
    }

    const tenantId = this.context.tenantId;
    const userId = this.context.userId;
    if (!tenantId || !userId) {
      throw new ForbiddenException('Authentication required');
    }

    const grants = await this.userRolesService.resolveGrants(tenantId, userId, this.context.organizationId ?? undefined);

    if (requiredRoles?.length && !requiredRoles.some((role) => grants.roleCodes.includes(role))) {
      throw new ForbiddenException('Insufficient role to access this resource');
    }

    if (requiredPermissions?.length && !requiredPermissions.every((perm) => grants.permissionCodes.includes(perm))) {
      throw new ForbiddenException('Insufficient permissions to access this resource');
    }

    return true;
  }
}
