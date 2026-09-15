import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createServiceAccount, listServiceAccountsForApplication, updatePlatformServiceAccount, type ServiceAccountStatus } from "@/shared/platform-api";

const keys = {
  forApplication: (applicationId: string) => ["platform", "applications", applicationId, "service-accounts"] as const,
};

export function useServiceAccountsForApplicationQuery(applicationId: string | undefined) {
  return useQuery({
    queryKey: keys.forApplication(applicationId ?? ""),
    queryFn: () => listServiceAccountsForApplication(applicationId as string, { limit: 100 }),
    enabled: !!applicationId,
  });
}

export function useCreateServiceAccountMutation(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createServiceAccount(applicationId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.forApplication(applicationId) }),
  });
}

export function useUpdateServiceAccountMutation(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ServiceAccountStatus }) => updatePlatformServiceAccount(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.forApplication(applicationId) }),
  });
}
