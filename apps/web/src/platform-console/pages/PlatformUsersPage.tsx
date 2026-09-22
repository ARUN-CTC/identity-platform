import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/**
 * Phase 2UI.3 — Global Users is genuinely platform-wide by data model
 * (SecurityUser has no tenant_id column — every real Identity is already
 * global), but `GET /users` is tenant-scoped (reads the caller's ambient
 * tenant context, which a Platform Operator never has) and no
 * platform-level user-list endpoint exists. Documented in
 * docs/PHASE_2UI3.md's own API Gap table — Recommended Phase: a future
 * P1 pass, alongside the Memberships/Invitations aggregate endpoints
 * (same root cause: no cross-tenant read exists for any of the three).
 */
export default function PlatformUsersPage() {
  return (
    <PlatformApiGapPage
      title="Users"
      description="Every global Identity on this platform, across every tenant."
      gapDescription="No platform-wide user list endpoint exists yet — GET /users is tenant-scoped only, and a Platform Operator has no ambient tenant to read it as. A new endpoint is required (see docs/PHASE_2UI3.md)."
    />
  );
}
