import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/**
 * Phase 2UI.3 — the backend has POST /invitations/validate and
 * POST /invitations/accept (both public, end-user-facing) but no
 * GET /invitations tracking/list endpoint at all — an operator cannot see
 * which invitations are pending/expired/accepted anywhere today. See
 * docs/PHASE_2UI3.md's API Gap table.
 */
export default function PlatformInvitationsPage() {
  return (
    <PlatformApiGapPage
      title="Invitations"
      description="Pending, accepted, and expired administrator/user invitations across every tenant."
      gapDescription="No invitation-tracking endpoint exists — only the end-user accept flow (POST /invitations/accept) does. A GET /invitations list is required to show status here."
    />
  );
}
