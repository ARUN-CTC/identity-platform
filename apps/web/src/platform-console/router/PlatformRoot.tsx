import { Outlet } from "react-router-dom";

import { PlatformAuthProvider } from "../providers/PlatformAuthProvider";

/**
 * Wraps the ENTIRE Platform Console route subtree (login + protected
 * shell) with its own `PlatformAuthProvider` — a single instance shared by
 * both branches so signing in on the login page and landing on the
 * protected shell afterward don't remount the provider. Deliberately the
 * only thing this component does: no tenant AuthProvider/PermissionProvider/
 * TenantProvider anywhere in this tree, and nothing here reads or writes
 * their state either.
 */
export function PlatformRoot() {
  return (
    <PlatformAuthProvider>
      <Outlet />
    </PlatformAuthProvider>
  );
}
