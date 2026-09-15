import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

// Mirrors the real Tenant.status values (database/prisma/schema/tenant.prisma).
export type TenantStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED";

export interface PlatformTenant {
  id: string;
  tenantCode: string;
  tenantName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  status: TenantStatus;
  activatedAt?: string | null;
  suspendedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

// Mirrors src/modules/tenants/dto/create-tenant.dto.ts
export interface CreateTenantInput {
  tenantCode: string;
  tenantName: string;
  legalName?: string;
  email?: string;
  phone?: string;
}

// Mirrors src/modules/tenants/dto/update-tenant.dto.ts (the platform-side
// DTO, which — unlike the tenant self-service one — still accepts status;
// TenantsService.activate()/suspend() apply no current-status validation
// of their own, so the dedicated activate/suspend actions below are
// preferred over sending status through this generic update).
export type UpdateTenantInput = Partial<Omit<CreateTenantInput, "tenantCode">> & { status?: TenantStatus };

const BASE = "/platform/tenants";

export function listPlatformTenants(params: ListParams = {}): Promise<PaginatedResult<PlatformTenant>> {
  return platformApiRequest<PaginatedResult<PlatformTenant>>(BASE, { query: params });
}

export function getPlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}`);
}

export function createPlatformTenant(input: CreateTenantInput): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(BASE, { method: "POST", body: input });
}

export function updatePlatformTenant(id: string, input: UpdateTenantInput): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

export function activatePlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}/activate`, { method: "POST" });
}

export function suspendPlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}/suspend`, { method: "POST" });
}

/** Soft delete — TenantsService.remove() calls findById() then softDelete() unconditionally; no dependency/membership guard exists, same as Organization's own delete. */
export function deletePlatformTenant(id: string): Promise<null> {
  return platformApiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}
