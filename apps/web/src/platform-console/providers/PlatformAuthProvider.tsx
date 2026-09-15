import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  bootstrapPlatformApiClient,
  clearPlatformSession,
  getCurrentPlatformOperator,
  onPlatformSessionExpired,
  platformLogin as platformLoginRequest,
  platformLogout as platformLogoutRequest,
  readPersistedPlatformRefreshToken,
  refreshPlatformSession,
  setPlatformAccessToken,
  setPlatformRefreshToken,
  type CurrentPlatformOperator,
} from "@/shared/platform-api";

export interface PlatformLoginCredentials {
  email: string;
  password: string;
  deviceInfo?: string;
}

interface PlatformAuthContextValue {
  operator: CurrentPlatformOperator | null;
  permissionCodes: string[];
  hasPlatformPermission: (code: string) => boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: PlatformLoginCredentials) => Promise<void>;
  signOut: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

/**
 * The Platform Operator boundary's own auth provider — deliberately NOT a
 * variant of the tenant `AuthProvider`, and never mounted alongside it in
 * any way that shares state: no shared token store, no shared session
 * store, no "current scope" toggle between the two. This is the frontend
 * mirror of the backend's own separate PlatformJwtAuthGuard/
 * platform_operator_session boundary — see
 * [[platform-operator-is-separate-auth-boundary]].
 *
 * Session persistence is deliberately shorter-lived than the tenant app's:
 * the refresh token always lives in sessionStorage (see
 * shared/platform-api/session.ts) — a Platform Operator session does not
 * survive closing the tab, on purpose, given how privileged this boundary
 * is.
 */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<CurrentPlatformOperator | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrapPlatformApiClient();

    const unsubscribe = onPlatformSessionExpired(() => {
      setOperator(null);
      setIsAuthenticated(false);
    });

    (async () => {
      const persisted = readPersistedPlatformRefreshToken();
      if (!persisted) {
        setIsLoading(false);
        return;
      }
      setPlatformRefreshToken(persisted);
      const refreshed = await refreshPlatformSession();
      if (!refreshed) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await getCurrentPlatformOperator();
        setOperator(me);
        setIsAuthenticated(true);
      } catch {
        clearPlatformSession();
      } finally {
        setIsLoading(false);
      }
    })();

    return unsubscribe;
  }, []);

  const login = async (credentials: PlatformLoginCredentials) => {
    const tokens = await platformLoginRequest(credentials);
    setPlatformAccessToken(tokens.accessToken);
    setPlatformRefreshToken(tokens.refreshToken);
    const me = await getCurrentPlatformOperator();
    setOperator(me);
    setIsAuthenticated(true);
  };

  const signOut = async () => {
    try {
      await platformLogoutRequest();
    } catch {
      // Best-effort — clear local state regardless of whether the server call succeeded.
    }
    clearPlatformSession();
    setOperator(null);
    setIsAuthenticated(false);
  };

  const value: PlatformAuthContextValue = {
    operator,
    permissionCodes: operator?.permissionCodes ?? [],
    hasPlatformPermission: (code: string) => operator?.permissionCodes.includes(code) ?? false,
    isAuthenticated,
    isLoading,
    login,
    signOut,
  };

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const context = useContext(PlatformAuthContext);
  if (!context) {
    throw new Error("usePlatformAuth must be used within a PlatformAuthProvider");
  }
  return context;
}
