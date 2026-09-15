import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface BreadcrumbLabelContextValue {
  label: string | undefined;
  setLabel: (label: string | undefined) => void;
}

const BreadcrumbLabelContext = createContext<BreadcrumbLabelContextValue | null>(null);

/**
 * Wraps the region between AppShell's Topbar and its routed page content
 * (see AppShell.tsx) so a detail page (the Outlet content) can hand its
 * record's display name up to PageContainer (the breadcrumb renderer)
 * without prop-drilling through the router.
 */
export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [label, setLabel] = useState<string | undefined>(undefined);

  // A label set by one detail page must never leak onto the next page —
  // reset on every navigation; a page that wants one sets it again itself.
  useEffect(() => {
    setLabel(undefined);
  }, [location.pathname]);

  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbLabelContext.Provider value={value}>{children}</BreadcrumbLabelContext.Provider>;
}

function useBreadcrumbLabelContext(): BreadcrumbLabelContextValue {
  const context = useContext(BreadcrumbLabelContext);
  if (!context) {
    throw new Error("useBreadcrumbLabelContext must be used within a BreadcrumbLabelProvider");
  }
  return context;
}

/** Consumed by PageContainer only — reads whatever the current page has registered, if anything. */
export function useBreadcrumbLabelValue(): string | undefined {
  return useBreadcrumbLabelContext().label;
}

/**
 * Call from a detail page once its record has loaded, to append the
 * record's human-readable name/number as the breadcrumb trail's final,
 * non-link segment — e.g. "Rahul Sharma", "INQ015580". Never pass a raw
 * id/UUID. Pass `undefined` (or nothing, while the record is still loading)
 * to leave the trail at its list-page-derived default.
 */
export function useBreadcrumbLabel(label: string | undefined): void {
  const { setLabel } = useBreadcrumbLabelContext();
  useEffect(() => {
    setLabel(label);
    return () => setLabel(undefined);
  }, [label, setLabel]);
}
