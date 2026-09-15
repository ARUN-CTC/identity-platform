import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createOrganization,
  deleteOrganization,
  getOrganization,
  listMembers,
  listOrganizationTypes,
  listOrganizations,
  resendUserInvitation,
  updateMembershipStatus,
  updateOrganization,
  type AdminSettableMembershipStatus,
  type CreateOrganizationInput,
  type ListParams,
  type UpdateOrganizationInput,
} from "@/shared/api";

const organizationsKeys = {
  all: ["organizations"] as const,
  lists: () => [...organizationsKeys.all, "list"] as const,
  list: (params: ListParams) => [...organizationsKeys.lists(), params] as const,
  details: () => [...organizationsKeys.all, "detail"] as const,
  detail: (id: string) => [...organizationsKeys.details(), id] as const,
  members: (id: string, params: ListParams) => [...organizationsKeys.detail(id), "members", params] as const,
};

export function useOrganizationsQuery(params: ListParams) {
  return useQuery({
    queryKey: organizationsKeys.list(params),
    queryFn: () => listOrganizations(params),
    placeholderData: (previousData) => previousData,
  });
}

export function useOrganizationQuery(id: string | undefined) {
  return useQuery({
    queryKey: organizationsKeys.detail(id ?? ""),
    queryFn: () => getOrganization(id as string),
    enabled: !!id,
  });
}

function useInvalidateOrganizations() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: organizationsKeys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: organizationsKeys.detail(id) });
  };
}

export function useCreateOrganizationMutation() {
  const invalidate = useInvalidateOrganizations();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateOrganizationMutation(id: string) {
  const invalidate = useInvalidateOrganizations();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) => updateOrganization(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteOrganizationMutation() {
  const invalidate = useInvalidateOrganizations();
  return useMutation({
    mutationFn: (id: string) => deleteOrganization(id),
    onSuccess: () => invalidate(),
  });
}

/** For the Create Organization form's type picker. Gated on ORGANIZATION_MANAGE server-side, same as everything else in this module — no separate permission check needed at the call site. */
export function useOrganizationTypesLookupQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["organization-types", "lookup"] as const,
    queryFn: () => listOrganizationTypes({ limit: 100 }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMembersQuery(organizationId: string | undefined, params: ListParams) {
  return useQuery({
    queryKey: organizationsKeys.members(organizationId ?? "", params),
    queryFn: () => listMembers(organizationId as string, params),
    enabled: !!organizationId,
    placeholderData: (previousData) => previousData,
  });
}

export function useInvalidateMembers(organizationId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: organizationsKeys.detail(organizationId) });
}

export function useUpdateMembershipStatusMutation(organizationId: string) {
  const invalidateMembers = useInvalidateMembers(organizationId);
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: AdminSettableMembershipStatus }) =>
      updateMembershipStatus(organizationId, userId, status),
    onSuccess: () => invalidateMembers(),
  });
}

export function useResendInvitationMutation(organizationId: string) {
  const invalidateMembers = useInvalidateMembers(organizationId);
  return useMutation({
    mutationFn: (userId: string) => resendUserInvitation(userId, organizationId),
    onSuccess: () => invalidateMembers(),
  });
}
