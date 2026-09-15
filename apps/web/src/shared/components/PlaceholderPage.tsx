import { EmptyState } from "@/design-system/components/EmptyState";
import { PageHeader } from "@/design-system/components/PageHeader";

export interface PlaceholderPageProps {
  title: string;
  description?: string;
}

/**
 * Standard shape for a domain screen that hasn't been built yet: real
 * PageHeader + EmptyState, wired into routing/navigation now so the
 * information architecture holds together ahead of that screen's own
 * build-out. Swap for a real page once its domain's admin-console
 * screens are implemented (Tenants/Users/Applications/Security/Platform
 * Administration — see the Phase 1 plan's "not built this phase" list).
 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        variant="no-data"
        title="Coming soon"
        description="This area isn't available yet — we're still building it. Check back in a future update."
      />
    </>
  );
}
