import { platformApiRequest } from "./client";

// Mirrors src/modules/platform-operators/dto/platform-login.dto.ts — no
// tenantCode, deliberately: a Platform Operator may hold zero Organization
// Memberships and never resolves a tenant at login.
export interface PlatformLoginInput {
  email: string;
  password: string;
  deviceInfo?: string;
}

// Mirrors PlatformAuthTokens in src/modules/platform-operators/services/platform-authentication.service.ts
export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

// Mirrors PlatformAuthenticationService.getMe()'s return shape.
export interface CurrentPlatformOperator {
  id: string;
  email: string;
  permissionCodes: string[];
}

export function platformLogin(input: PlatformLoginInput): Promise<PlatformAuthTokens> {
  return platformApiRequest<PlatformAuthTokens>("/platform/auth/login", { method: "POST", body: input });
}

export function platformRefreshToken(refreshToken: string): Promise<PlatformAuthTokens> {
  return platformApiRequest<PlatformAuthTokens>("/platform/auth/refresh", { method: "POST", body: { refreshToken } });
}

export function getCurrentPlatformOperator(): Promise<CurrentPlatformOperator> {
  return platformApiRequest<CurrentPlatformOperator>("/platform/auth/me");
}

export function platformLogout(): Promise<null> {
  return platformApiRequest<null>("/platform/auth/logout", { method: "POST" });
}
