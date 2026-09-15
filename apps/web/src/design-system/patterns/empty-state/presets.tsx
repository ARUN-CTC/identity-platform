import Button from "@mui/material/Button";
import type { ReactNode } from "react";

import { EmptyState } from "@/design-system/components/EmptyState";

/**
 * Named presets over EmptyState for the handful of cases that recur on
 * nearly every page (spec §25) — use these instead of re-typing the
 * title/description/variant triad at each call site.
 */

export function NoResultsState({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <EmptyState
      variant="no-results"
      title="No results match your filters"
      description="Try adjusting or clearing your search and filters."
      action={
        onClearFilters ? (
          <Button variant="outlined" size="small" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

export function PermissionDeniedState() {
  return (
    <EmptyState
      variant="permission-denied"
      title="You don't have access to this page"
      description="Contact your administrator if you believe this is a mistake."
    />
  );
}

export function NotFoundState({ description = "The page you're looking for doesn't exist or has been moved." }: { description?: string }) {
  return <EmptyState variant="not-found" title="Page not found" description={description} />;
}

export function NetworkErrorState({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      variant="network-error"
      title="You're offline"
      description="Check your connection and try again."
      action={action}
    />
  );
}
