import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  activateUser,
  assignUserRole,
  createUser,
  deactivateUser,
  deleteUser,
  getUser,
  listOrganizations,
  listRoles,
  listUserRoles,
  listUsers,
  revokeUserRole,
  suspendUser,
  updateUser,
  type AssignRoleInput,
  type CreateUserInput,
  type RoleListParams,
  type UpdateUserInput,
  type UserListParams,
} from "@/shared/api";

const usersKeys = {
  all: ["users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (params: UserListParams) => [...usersKeys.lists(), params] as const,
  details: () => [...usersKeys.all, "detail"] as const,
  detail: (id: string) => [...usersKeys.details(), id] as const,
  roles: (id: string) => [...usersKeys.detail(id), "roles"] as const,
};

export function useUsersQuery(params: UserListParams) {
  return useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => listUsers(params),
    placeholderData: (previousData) => previousData,
  });
}

export function useUserQuery(id: string | undefined) {
  return useQuery({
    queryKey: usersKeys.detail(id ?? ""),
    queryFn: () => getUser(id as string),
    enabled: !!id,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: usersKeys.detail(id) });
  };
}

export function useCreateUserMutation() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateUserInput) => createUser(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateUserMutation(id: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => updateUser(id, input),
    onSuccess: () => invalidate(id),
  });
}

export type UserLifecycleAction = "activate" | "suspend" | "deactivate";

const LIFECYCLE_FN = {
  activate: activateUser,
  suspend: suspendUser,
  deactivate: deactivateUser,
} as const;

/**
 * One mutation per lifecycle action rather than a single parameterized one
 * — each has its own real, distinct backend transition (see
 * UsersService.LIFECYCLE_TRANSITIONS) and its own confirmation copy at the
 * call site; sharing a mutation object across them would blur their
 * independent `isPending` states in the UI (e.g. Suspend appearing to spin
 * while Deactivate is the one in flight).
 */
export function useUserLifecycleMutation(id: string, action: UserLifecycleAction) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: () => LIFECYCLE_FN[action](id),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteUserMutation() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => invalidate(),
  });
}

export function useUserRolesQuery(userId: string | undefined) {
  return useQuery({
    queryKey: usersKeys.roles(userId ?? ""),
    queryFn: () => listUserRoles(userId as string),
    enabled: !!userId,
  });
}

export function useAssignRoleMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignRoleInput) => assignUserRole(userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.roles(userId) }),
  });
}

export function useRevokeRoleMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokeUserRole(userId, grantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.roles(userId) }),
  });
}

/** For the role-assignment picker — every role the current tenant may see (system roles + this tenant's own custom ones; SUPER_ADMIN itself is server-filtered out unless the caller holds it — see RolesService). */
export function useRolesLookupQuery(params: RoleListParams = { limit: 100 }) {
  return useQuery({
    queryKey: ["roles", "lookup", params] as const,
    queryFn: () => listRoles(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * For the role-assignment organization-scope picker. Only call with
 * `enabled: true` when the caller actually holds ORGANIZATION_MANAGE (see
 * shared/api/organizations.ts's own doc comment) — this deliberately never
 * fires otherwise, so a caller lacking that permission gets a graceful
 * "tenant-wide only" picker instead of a 403 network error.
 */
export function useOrganizationsLookupQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["organizations", "lookup"] as const,
    queryFn: () => listOrganizations({ limit: 100 }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
