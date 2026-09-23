import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listOrganizations,
  listTenantMemberships,
  updateMembershipStatus,
  type AdminSettableMembershipStatus,
  type TenantMembershipListParams,
} from "@/shared/api";

const membershipsKeys = {
  all: ["memberships"] as const,
  list: (params: TenantMembershipListParams) => [...membershipsKeys.all, "list", params] as const,
};

/** Tenant-wide — GET /memberships, gated on USER_VIEW server-side (see shared/api/memberships.ts). */
export function useTenantMembershipsQuery(params: TenantMembershipListParams, enabled = true) {
  return useQuery({
    queryKey: membershipsKeys.list(params),
    queryFn: () => listTenantMemberships(params),
    enabled,
    placeholderData: (previousData) => previousData,
  });
}

/** For the Organization filter dropdown — same small lookup pattern as CreateUserDrawer's own organization picker. */
export function useOrganizationsLookupQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["organizations", "lookup"] as const,
    queryFn: () => listOrganizations({ limit: 100 }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Unlike organizations/hooks.ts's useUpdateMembershipStatusMutation(organizationId),
 * this list spans every organization in the tenant, so organizationId varies
 * per row — passed at call time instead of bound up front. Invalidates the
 * whole tenant-wide list (any filter combination) rather than a single
 * organization's detail cache.
 */
export function useUpdateTenantMembershipStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, userId, status }: { organizationId: string; userId: string; status: AdminSettableMembershipStatus }) =>
      updateMembershipStatus(organizationId, userId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membershipsKeys.all }),
  });
}
