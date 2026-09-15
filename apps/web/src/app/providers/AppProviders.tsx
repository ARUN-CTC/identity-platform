import type { ReactNode } from "react";

import { ConfirmProvider } from "@/design-system/patterns/confirmation";

import { AuthProvider } from "./AuthProvider";
import { NotificationProvider } from "./NotificationProvider";
import { PermissionProvider } from "./PermissionProvider";
import { QueryProvider } from "./QueryProvider";
import { TenantProvider } from "./TenantProvider";
import { ThemeModeProvider } from "./ThemeModeProvider";

/**
 * Composition order matters: Theme must wrap everything (Notification's
 * Snackbar/Alert need theme context), Auth/Tenant sit above Permission
 * since permission resolution depends on both.
 *
 * Unlike TravelOS's own AppProviders, there is no PlatformScopeProvider
 * here — Identity Platform's Platform Operator concept is a wholly
 * separate authentication/authorization boundary (its own login, JWT, and
 * guards — see src/modules/platform-operators/ on the backend), never a
 * scope a tenant session can toggle into. See
 * shared/auth/useRoleContext.ts's own doc comment for the full reasoning.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <QueryProvider>
        <NotificationProvider>
          <ConfirmProvider>
            <AuthProvider>
              <TenantProvider>
                <PermissionProvider>{children}</PermissionProvider>
              </TenantProvider>
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryProvider>
    </ThemeModeProvider>
  );
}
