import { useAuth } from "@/app/providers/AuthProvider";
import { PERMISSIONS } from "./permissions";

export type RoleContextKind = "SUPER_ADMIN" | "TENANT_ADMIN" | "MEMBER";

export interface RoleContext {
  kind: RoleContextKind;
  /** Business-friendly label for the role indicator (profile menu, admin screens) — never the raw system role code. */
  businessLabel: string;
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
  isMember: boolean;
}

const LABELS: Record<RoleContextKind, string> = {
  SUPER_ADMIN: "Super Administrator",
  TENANT_ADMIN: "Tenant Administrator",
  MEMBER: "Member",
};

/**
 * Single source of truth for "which of the three tenant-scoped responsibility
 * tiers is this user in" — mirrors database/seeds/002_system_roles.sql's own
 * three system roles (SUPER_ADMIN/TENANT_ADMIN/MEMBER) exactly: SUPER_ADMIN
 * holds every non-platform-only permission including TENANT_MANAGE,
 * TENANT_ADMIN holds everything except TENANT_MANAGE, MEMBER holds nothing
 * by default.
 *
 * Important — this is entirely distinct from the platform's separate
 * Platform Operator concept (src/modules/platform-operators/): even
 * SUPER_ADMIN here is a broad TENANT-scoped role, not platform-level
 * authority. There is no "enter platform scope" toggle in this app — a
 * Platform Operator authenticates through its own, wholly separate login
 * flow, never through this tenant session (see docs/ARCHITECTURE.md and
 * the Phase 1 plan's note on why PlatformScopeProvider was not ported).
 *
 * This is presentation framing only, exactly like PermissionGate — it never
 * grants or withholds anything itself. The real boundary is still each
 * route's own `permission`/`anyOfPermissions` gate plus backend
 * authorization; this hook only decides which label and which
 * dashboard/nav framing to show.
 */
export function useRoleContext(): RoleContext {
  const { permissions } = useAuth();
  const isSuperAdmin = permissions.includes(PERMISSIONS.TENANT_MANAGE);
  const isTenantAdmin = !isSuperAdmin && permissions.includes(PERMISSIONS.USER_MANAGE);
  const isMember = !isSuperAdmin && !isTenantAdmin;
  const kind: RoleContextKind = isSuperAdmin ? "SUPER_ADMIN" : isTenantAdmin ? "TENANT_ADMIN" : "MEMBER";

  return {
    kind,
    businessLabel: LABELS[kind],
    isSuperAdmin,
    isTenantAdmin,
    isMember,
  };
}
