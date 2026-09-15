import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

export type ProductStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface PlatformProduct {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt?: string | null;
}

// Mirrors src/modules/products/dto/create-product.dto.ts
export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string;
}

// Mirrors src/modules/products/dto/update-product.dto.ts — no `slug` (immutable after creation).
export interface UpdateProductInput {
  name?: string;
  description?: string;
  status?: ProductStatus;
}

const BASE = "/products";

/** Gated on PRODUCT_VIEW. */
export function listPlatformProducts(params: ListParams = {}): Promise<PaginatedResult<PlatformProduct>> {
  return platformApiRequest<PaginatedResult<PlatformProduct>>(BASE, { query: params });
}

export function getPlatformProduct(id: string): Promise<PlatformProduct> {
  return platformApiRequest<PlatformProduct>(`${BASE}/${id}`);
}

/** Gated on PRODUCT_MANAGE. `slug` must be lowercase, hyphenated, unique case-insensitively. */
export function createPlatformProduct(input: CreateProductInput): Promise<PlatformProduct> {
  return platformApiRequest<PlatformProduct>(BASE, { method: "POST", body: input });
}

/** No DELETE endpoint exists — status (ACTIVE/SUSPENDED/DISABLED) is the only lifecycle mechanism. */
export function updatePlatformProduct(id: string, input: UpdateProductInput): Promise<PlatformProduct> {
  return platformApiRequest<PlatformProduct>(`${BASE}/${id}`, { method: "PATCH", body: input });
}
