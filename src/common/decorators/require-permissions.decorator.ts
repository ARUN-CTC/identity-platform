import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';

/**
 * Read by PermissionsGuard. Multiple codes require ALL of them (AND
 * semantics). Phase 1 extracted source — copied from TravelOS, classified
 * REUSABLE — this is the real authorization boundary, never a role-name
 * check.
 */
export const RequirePermissions = (...permissionCodes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissionCodes);
