import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Tenant } from "@/shared/types/auth";

import { useAuth } from "./AuthProvider";

interface TenantContextValue {
  /** Null until `/auth/me` has resolved (see AuthProvider) — briefly, right after login/session restore. */
  tenant: Tenant | null;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * Purely a thin, stable-hook wrapper around AuthProvider's `/auth/me`-
 * sourced tenant record — kept as a separate provider/hook so `useTenant()`
 * call sites don't need to change if tenant display logic grows beyond a
 * single field. There is no `switchTenant()` here (unlike a single-tenant
 * product might expose): a Membership-bearing Identity moves between
 * tenants by selecting a different organization via
 * `useAuth().switchOrganization()` — see AuthProvider's own doc comment —
 * which the backend resolves as a cross-tenant switch when the target
 * organization belongs to a different tenant than the current session.
 * There is no separate "switch tenant directly" concept beyond that.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();

  const value = useMemo<TenantContextValue>(() => ({ tenant }), [tenant]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}
