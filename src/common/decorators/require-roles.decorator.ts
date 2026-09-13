import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ROLES_KEY = 'require_roles';

/**
 * Read by PermissionsGuard. Multiple codes require ANY of them (OR
 * semantics) — coarser than @RequirePermissions, prefer permissions for
 * real authorization decisions. Phase 1 extracted source — copied from
 * TravelOS, classified REUSABLE.
 */
export const RequireRoles = (...roleCodes: string[]) => SetMetadata(REQUIRE_ROLES_KEY, roleCodes);
