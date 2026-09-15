import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPlatformOperator,
  getPlatformOperator,
  grantPlatformOperatorPermission,
  listPlatformOperators,
  revokePlatformOperatorPermission,
  setPlatformOperatorStatus,
  type CreatePlatformOperatorInput,
  type PlatformOperatorStatus,
} from "@/shared/platform-api";
import type { ListParams } from "@/shared/api";

const keys = {
  all: ["platform", "operators"] as const,
  lists: () => [...keys.all, "list"] as const,
  list: (params: ListParams) => [...keys.lists(), params] as const,
  detail: (id: string) => [...keys.all, "detail", id] as const,
};

export function usePlatformOperatorsQuery(params: ListParams) {
  return useQuery({ queryKey: keys.list(params), queryFn: () => listPlatformOperators(params), placeholderData: (p) => p });
}

export function usePlatformOperatorQuery(id: string | undefined) {
  return useQuery({ queryKey: keys.detail(id ?? ""), queryFn: () => getPlatformOperator(id as string), enabled: !!id });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: keys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: keys.detail(id) });
  };
}

export function useCreatePlatformOperatorMutation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreatePlatformOperatorInput) => createPlatformOperator(input), onSuccess: () => invalidate() });
}

export function useSetPlatformOperatorStatusMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (status: PlatformOperatorStatus) => setPlatformOperatorStatus(id, status), onSuccess: () => invalidate(id) });
}

export function useGrantPlatformOperatorPermissionMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (permissionCode: string) => grantPlatformOperatorPermission(id, permissionCode), onSuccess: () => invalidate(id) });
}

export function useRevokePlatformOperatorPermissionMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (permissionCode: string) => revokePlatformOperatorPermission(id, permissionCode), onSuccess: () => invalidate(id) });
}
