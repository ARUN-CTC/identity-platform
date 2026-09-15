import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PLATFORM_PERMISSIONS_KEY = 'require_platform_permissions';

/**
 * Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — the platform-scope
 * equivalent of @RequirePermissions, read by PlatformPermissionsGuard.
 * Deliberately a separate decorator/guard/metadata key from the tenant one:
 * a route decorated with this can only ever be satisfied by a Platform
 * Operator's own permission grants (platform_operator_permission), never by
 * any tenant-scoped role, however broad (Security Invariant #1 —
 * docs/adr/ADR-010-platform-operator-security-boundary.md).
 */
export const RequirePlatformPermissions = (...permissionCodes: string[]) =>
  SetMetadata(REQUIRE_PLATFORM_PERMISSIONS_KEY, permissionCodes);
