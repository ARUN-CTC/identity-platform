import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

export type ServiceAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";
export type GrantStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface PlatformServiceAccount {
  id: string;
  applicationId: string;
  name: string;
  status: ServiceAccountStatus;
  credentialCreatedAt: string;
  credentialRevokedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

/**
 * `create()`'s response includes the plaintext credential exactly once —
 * it is never shown again after this call (backend never returns
 * `credentialHash` from any endpoint). `rotateServiceAccountCredential()`
 * below (Phase 2UI.2) is the only other call that ever sees a plaintext
 * value — a distinct action from create, never a "read" of the existing one.
 */
export interface CreatedServiceAccount extends PlatformServiceAccount {
  credential: string;
}

export interface ServiceAccountTenantGrant {
  id: string;
  tenantId: string;
  serviceAccountId: string;
  status: GrantStatus;
  createdAt: string;
  updatedAt?: string | null;
  serviceAccount?: { id: string; name: string; status: string; applicationId: string };
}

export type PatchableGrantStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

/** Gated on SERVICE_ACCOUNT_VIEW. */
export function listServiceAccountsForApplication(applicationId: string, params: ListParams = {}): Promise<PaginatedResult<PlatformServiceAccount>> {
  return platformApiRequest<PaginatedResult<PlatformServiceAccount>>(`/applications/${applicationId}/service-accounts`, { query: params });
}

export function getPlatformServiceAccount(id: string): Promise<PlatformServiceAccount> {
  return platformApiRequest<PlatformServiceAccount>(`/service-accounts/${id}`);
}

/** Gated on SERVICE_ACCOUNT_MANAGE. No scope/product field — a ServiceAccount has no privileges of its own; it inherits the owning Application's allowedScopes/audiences/grantTypes entirely. */
export function createServiceAccount(applicationId: string, name: string): Promise<CreatedServiceAccount> {
  return platformApiRequest<CreatedServiceAccount>(`/applications/${applicationId}/service-accounts`, { method: "POST", body: { name } });
}

export function updatePlatformServiceAccount(id: string, input: { name?: string; status?: ServiceAccountStatus }): Promise<PlatformServiceAccount> {
  return platformApiRequest<PlatformServiceAccount>(`/service-accounts/${id}`, { method: "PATCH", body: input });
}

/**
 * Phase 2UI.2 backend, Phase 2UI.3 frontend. Gated on SERVICE_ACCOUNT_MANAGE.
 * ATOMIC REPLACEMENT, only for an ACTIVE service account (409 for
 * SUSPENDED/DISABLED). Never touches applicationId, status, or tenant
 * grants — only the credential itself.
 */
export function rotateServiceAccountCredential(id: string): Promise<CreatedServiceAccount> {
  return platformApiRequest<CreatedServiceAccount>(`/service-accounts/${id}/credentials/rotate`, { method: "POST" });
}

const grantsBase = (tenantId: string) => `/platform/tenants/${tenantId}/service-account-grants`;

/** Gated on SERVICE_ACCOUNT_TENANT_GRANT_VIEW. */
export function listServiceAccountGrantsForTenant(tenantId: string): Promise<ServiceAccountTenantGrant[]> {
  return platformApiRequest<ServiceAccountTenantGrant[]>(grantsBase(tenantId));
}

/** Gated on SERVICE_ACCOUNT_TENANT_GRANT_MANAGE. Created ACTIVE. 409 if a grant record for this (serviceAccount, tenant) pair already exists. */
export function createServiceAccountGrant(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
  return platformApiRequest<ServiceAccountTenantGrant>(grantsBase(tenantId), { method: "POST", body: { serviceAccountId } });
}

export function updateServiceAccountGrantStatus(tenantId: string, serviceAccountId: string, status: PatchableGrantStatus): Promise<ServiceAccountTenantGrant> {
  return platformApiRequest<ServiceAccountTenantGrant>(`${grantsBase(tenantId)}/${serviceAccountId}`, { method: "PATCH", body: { status } });
}

/** The only path from REVOKED back to ACTIVE. */
export function reactivateServiceAccountGrant(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
  return platformApiRequest<ServiceAccountTenantGrant>(`${grantsBase(tenantId)}/${serviceAccountId}/reactivate`, { method: "POST" });
}
