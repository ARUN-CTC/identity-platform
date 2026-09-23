import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getOwnTenant, updateOwnTenant, type UpdateTenantInput } from "@/shared/api";

const tenantSettingsKeys = {
  detail: () => ["tenant-settings", "me"] as const,
};

export function useOwnTenantQuery() {
  return useQuery({
    queryKey: tenantSettingsKeys.detail(),
    queryFn: () => getOwnTenant(),
  });
}

export function useUpdateOwnTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) => updateOwnTenant(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantSettingsKeys.detail() }),
  });
}
