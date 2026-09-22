import Button from "@mui/material/Button";
import { Link as RouterLink } from "react-router-dom";

import { EmptyState } from "@/design-system/components/EmptyState";
import { PageHeader } from "@/design-system/components/PageHeader";

export interface PlatformApiGapPageProps {
  title: string;
  /** What this screen would show, in one line — shown as the PageHeader's own description. */
  description: string;
  /** Why it isn't buildable today — cite the missing endpoint by name. */
  gapDescription: string;
  /** Where the operator can get equivalent information today, if anywhere. */
  workaround?: string;
  workaroundPath?: string;
}

/**
 * Phase 2UI.3 — the single, honest "this needs a backend endpoint that
 * doesn't exist yet" screen, used for every nav item this phase's own
 * governing brief asked for that has no real API behind it (Users,
 * Memberships, Invitations, a cross-product Applications index, a
 * cross-application Service Accounts index, Platform Configuration). Per
 * that brief's own §5/§45/§26: never fabricate data, never build a fake
 * table, always name the specific gap and the recommended phase — see
 * docs/PHASE_2UI3.md's own API Gap table for the authoritative version of
 * every gap this component surfaces.
 */
export function PlatformApiGapPage({ title, description, gapDescription, workaround, workaroundPath }: PlatformApiGapPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        variant="not-available"
        title="Not available yet"
        description={gapDescription}
        action={
          workaround ? (
            workaroundPath ? (
              <Button component={RouterLink} to={workaroundPath} size="small">
                {workaround}
              </Button>
            ) : (
              <span>{workaround}</span>
            )
          ) : undefined
        }
      />
    </>
  );
}
