import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
  type CreatePermissionInput,
  type PermissionListParams,
  type UpdatePermissionInput,
} from "@/shared/api";

const permissionsKeys = {
  all: ["permissions"] as const,
  lists: () => [...permissionsKeys.all, "list"] as const,
  list: (params: PermissionListParams) => [...permissionsKeys.lists(), params] as const,
};

export function usePermissionsQuery(params: PermissionListParams) {
  return useQuery({
    queryKey: permissionsKeys.list(params),
    queryFn: () => listPermissions(params),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidatePermissions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: permissionsKeys.lists() });
}

export function useCreatePermissionMutation() {
  const invalidate = useInvalidatePermissions();
  return useMutation({
    mutationFn: (input: CreatePermissionInput) => createPermission(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePermissionMutation(id: string) {
  const invalidate = useInvalidatePermissions();
  return useMutation({
    mutationFn: (input: UpdatePermissionInput) => updatePermission(id, input),
    onSuccess: () => invalidate(),
  });
}

export function useDeletePermissionMutation() {
  const invalidate = useInvalidatePermissions();
  return useMutation({
    mutationFn: (id: string) => deletePermission(id),
    onSuccess: () => invalidate(),
  });
}
