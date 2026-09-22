import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  activatePlatformTenant,
  bootstrapPlatformTenant,
  createPlatformTenant,
  deletePlatformTenant,
  getPlatformTenant,
  listPlatformTenants,
  suspendPlatformTenant,
  updatePlatformTenant,
  type BootstrapTenantInput,
  type CreateTenantInput,
  type UpdateTenantInput,
} from "@/shared/platform-api";
import type { ListParams } from "@/shared/api";

const keys = {
  all: ["platform", "tenants"] as const,
  lists: () => [...keys.all, "list"] as const,
  list: (params: ListParams) => [...keys.lists(), params] as const,
  detail: (id: string) => [...keys.all, "detail", id] as const,
};

export function usePlatformTenantsQuery(params: ListParams) {
  return useQuery({
    queryKey: keys.list(params),
    queryFn: () => listPlatformTenants(params),
    placeholderData: (previousData) => previousData,
  });
}

export function usePlatformTenantQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? ""),
    queryFn: () => getPlatformTenant(id as string),
    enabled: !!id,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: keys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: keys.detail(id) });
  };
}

export function useCreatePlatformTenantMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateTenantInput) => createPlatformTenant(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePlatformTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) => updatePlatformTenant(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useActivatePlatformTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => activatePlatformTenant(id),
    onSuccess: () => invalidate(id),
  });
}

export function useSuspendPlatformTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => suspendPlatformTenant(id),
    onSuccess: () => invalidate(id),
  });
}

export function useDeletePlatformTenantMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deletePlatformTenant(id),
    onSuccess: () => invalidate(),
  });
}

export function useBootstrapPlatformTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: BootstrapTenantInput) => bootstrapPlatformTenant(id, input),
    onSuccess: () => invalidate(id),
  });
}
