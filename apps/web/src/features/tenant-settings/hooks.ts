import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getOwnTenant, updateOwnTenant, type UpdateTenantInput } from "@/shared/api";

const tenantSettingsKeys = {
  detail: (tenantId: string) => ["tenant-settings", tenantId] as const,
};

/**
 * `tenantId` must always be the caller's own `useTenant().tenant.id` — never
 * a route param or other user-editable value. See shared/api/tenants.ts's
 * header comment for why: the backend endpoint this calls has no
 * ownership check of its own.
 */
export function useOwnTenantQuery(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantSettingsKeys.detail(tenantId ?? ""),
    queryFn: () => getOwnTenant(tenantId as string),
    enabled: !!tenantId,
  });
}

export function useUpdateOwnTenantMutation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) => updateOwnTenant(tenantId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantSettingsKeys.detail(tenantId) }),
  });
}
