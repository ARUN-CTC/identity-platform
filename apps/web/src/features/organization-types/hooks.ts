import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createOrganizationType,
  deleteOrganizationType,
  listOrganizationTypes,
  updateOrganizationType,
  type CreateOrganizationTypeInput,
  type ListParams,
  type UpdateOrganizationTypeInput,
} from "@/shared/api";

const organizationTypesKeys = {
  all: ["organization-types"] as const,
  lists: () => [...organizationTypesKeys.all, "list"] as const,
  list: (params: ListParams) => [...organizationTypesKeys.lists(), params] as const,
};

export function useOrganizationTypesQuery(params: ListParams) {
  return useQuery({
    queryKey: organizationTypesKeys.list(params),
    queryFn: () => listOrganizationTypes(params),
    placeholderData: (previousData) => previousData,
  });
}

// The Create/Edit Organization form's own type-picker lookup query
// (`useOrganizationTypesLookupQuery`) lives in features/organizations/hooks.ts,
// unchanged by this module — this file only adds the admin CRUD surface.
// Its own cache key (["organization-types", "lookup"]) is invalidated below
// too, so creating/editing/deleting a type here keeps that picker fresh.
function useInvalidateOrganizationTypes() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: organizationTypesKeys.all });
    queryClient.invalidateQueries({ queryKey: ["organization-types", "lookup"] });
  };
}

export function useCreateOrganizationTypeMutation() {
  const invalidate = useInvalidateOrganizationTypes();
  return useMutation({
    mutationFn: (input: CreateOrganizationTypeInput) => createOrganizationType(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateOrganizationTypeMutation(id: string) {
  const invalidate = useInvalidateOrganizationTypes();
  return useMutation({
    mutationFn: (input: UpdateOrganizationTypeInput) => updateOrganizationType(id, input),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteOrganizationTypeMutation() {
  const invalidate = useInvalidateOrganizationTypes();
  return useMutation({
    mutationFn: (id: string) => deleteOrganizationType(id),
    onSuccess: () => invalidate(),
  });
}
