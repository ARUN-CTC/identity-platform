import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

export type ClientType = "CONFIDENTIAL" | "PUBLIC";
export type ApplicationStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";
// Mirrors src/modules/applications/policies/grant-type.policy.ts — the only two grants this platform supports.
export type GrantType = "authorization_code" | "client_credentials";

export interface PlatformApplication {
  id: string;
  productId: string;
  name: string;
  clientId: string;
  clientType: ClientType;
  status: ApplicationStatus;
  redirectUris: string[];
  allowedOrigins: string[];
  grantTypes: GrantType[];
  allowedScopes: string[];
  audiences: string[];
  tokenEndpointAuthMethod: "client_secret_basic" | "none";
  secretCreatedAt?: string | null;
  secretRevokedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

/**
 * `create()`'s response includes `clientSecret` in plaintext exactly
 * once, for a CONFIDENTIAL client — it is never shown again after this
 * call (backend never returns `clientSecretHash` from any endpoint).
 * `clientSecret` is `null` for a PUBLIC client (no secret at all — PKCE is
 * its only proof of possession).
 */
export interface CreatedApplication extends PlatformApplication {
  clientSecret: string | null;
}

// Mirrors src/modules/applications/dto/create-application.dto.ts
export interface CreateApplicationInput {
  name: string;
  clientType?: ClientType;
  redirectUris?: string[];
  allowedOrigins?: string[];
  grantTypes?: GrantType[];
  allowedScopes?: string[];
  audiences?: string[];
}

// Mirrors update-application.dto.ts — no clientType/productId (both immutable after creation).
export interface UpdateApplicationInput {
  name?: string;
  status?: ApplicationStatus;
  redirectUris?: string[];
  allowedOrigins?: string[];
  grantTypes?: GrantType[];
  allowedScopes?: string[];
  audiences?: string[];
}

/** Gated on APPLICATION_VIEW. */
export function listApplicationsForProduct(productId: string, params: ListParams = {}): Promise<PaginatedResult<PlatformApplication>> {
  return platformApiRequest<PaginatedResult<PlatformApplication>>(`/products/${productId}/applications`, { query: params });
}

export function getPlatformApplication(id: string): Promise<PlatformApplication> {
  return platformApiRequest<PlatformApplication>(`/applications/${id}`);
}

/** Gated on APPLICATION_MANAGE. See CreatedApplication's own doc comment — the response's clientSecret is the ONLY time this app will ever see it in plaintext. */
export function createApplication(productId: string, input: CreateApplicationInput): Promise<CreatedApplication> {
  return platformApiRequest<CreatedApplication>(`/products/${productId}/applications`, { method: "POST", body: input });
}

export function updatePlatformApplication(id: string, input: UpdateApplicationInput): Promise<PlatformApplication> {
  return platformApiRequest<PlatformApplication>(`/applications/${id}`, { method: "PATCH", body: input });
}

/**
 * Phase 2UI.2 backend, Phase 2UI.3 frontend. Gated on APPLICATION_MANAGE.
 * ATOMIC REPLACEMENT — the old secret stops verifying the instant this
 * commits, no overlap window (see docs/CREDENTIAL_ROTATION.md). Only valid
 * for a CONFIDENTIAL, ACTIVE application (400/409 otherwise). The response
 * shows the new plaintext exactly once, same as create() — never returned
 * by any later GET.
 */
export function rotateApplicationSecret(id: string): Promise<CreatedApplication> {
  return platformApiRequest<CreatedApplication>(`/applications/${id}/credentials/rotate`, { method: "POST" });
}
