import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/** Phase 2UI.3 — same root cause as PlatformUsersPage: no cross-tenant Membership read endpoint exists. See docs/PHASE_2UI3.md's API Gap table. */
export default function PlatformMembershipsPage() {
  return (
    <PlatformApiGapPage
      title="Memberships"
      description="Every Identity <-> Tenant/Organization relationship on this platform."
      gapDescription="No platform-wide membership list endpoint exists yet. Membership records are readable today only from within a tenant's own session, or indirectly via a Tenant's Product Entitlements/Service Account Grants — never as a standalone cross-tenant list."
    />
  );
}
