import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRole,
  deleteRole,
  getRole,
  grantRolePermission,
  listPermissions,
  listRolePermissions,
  listRoles,
  revokeRolePermission,
  updateRole,
  type CreateRoleInput,
  type ListParams,
  type RoleListParams,
  type UpdateRoleInput,
} from "@/shared/api";

const rolesKeys = {
  all: ["roles"] as const,
  lists: () => [...rolesKeys.all, "list"] as const,
  list: (params: RoleListParams) => [...rolesKeys.lists(), params] as const,
  details: () => [...rolesKeys.all, "detail"] as const,
  detail: (id: string) => [...rolesKeys.details(), id] as const,
  permissions: (id: string) => [...rolesKeys.detail(id), "permissions"] as const,
};

export function useRolesQuery(params: RoleListParams) {
  return useQuery({
    queryKey: rolesKeys.list(params),
    queryFn: () => listRoles(params),
    placeholderData: (previousData) => previousData,
  });
}

export function useRoleQuery(id: string | undefined) {
  return useQuery({
    queryKey: rolesKeys.detail(id ?? ""),
    queryFn: () => getRole(id as string),
    enabled: !!id,
  });
}

function useInvalidateRoles() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: rolesKeys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: rolesKeys.detail(id) });
  };
}

export function useCreateRoleMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => createRole(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateRoleMutation(id: string) {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) => updateRole(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteRoleMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => invalidate(),
  });
}

export function useRolePermissionsQuery(roleId: string | undefined) {
  return useQuery({
    queryKey: rolesKeys.permissions(roleId ?? ""),
    queryFn: () => listRolePermissions(roleId as string),
    enabled: !!roleId,
  });
}

export function useGrantPermissionMutation(roleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (permissionId: string) => grantRolePermission(roleId, permissionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKeys.permissions(roleId) }),
  });
}

export function useRevokePermissionMutation(roleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (permissionId: string) => revokeRolePermission(roleId, permissionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKeys.permissions(roleId) }),
  });
}

/**
 * For the Grant Permission picker — deliberately unfiltered by
 * `platformOnly` at the query level (the full catalog is real, legitimate
 * data a PERMISSION_VIEW holder may see); GrantPermissionDialog itself
 * filters platform-only permissions out of the *selectable* list as a UX
 * courtesy, since attaching one to a tenant role always fails (a DB
 * trigger blocks it — see shared/api/roles.ts's own doc comment) — that
 * filter is not the security boundary, just avoiding a doomed request.
 */
export function usePermissionsLookupQuery(params: ListParams = { limit: 200 }) {
  return useQuery({
    queryKey: ["permissions", "lookup", params] as const,
    queryFn: () => listPermissions(params),
    staleTime: 5 * 60 * 1000,
  });
}
