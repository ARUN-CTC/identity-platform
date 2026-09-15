import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginatedResult } from "@/shared/api";

/**
 * Generic query-hook factory for any resource that's plain CRUD — a
 * PaginatedResult list, no lifecycle actions, no optimistic-locking on
 * update. Originally extracted from Foundation's Countries/Currencies/Time
 * Zones/Languages/Lookup-Categories (all this exact shape); Organization's
 * OrganizationType/OrganizationUnitType reuse it too. Each entity's
 * `use<Entity>Queries.ts` call site stays ~5 lines instead of duplicating
 * this ~90-line pattern (list/detail/create/update/delete + query keys +
 * cache invalidation) per resource. Resources with a different shape
 * (optimistic locking, dedicated lifecycle/status endpoints, nested
 * parent-scoped routes) don't fit this and should stay bespoke — see
 * Tenants' and Organization's own query hooks.
 */
export interface CrudSdk<TEntity, TListParams, TCreateInput, TUpdateInput> {
  list: (params: TListParams) => Promise<PaginatedResult<TEntity>>;
  get: (id: string) => Promise<TEntity>;
  create: (input: TCreateInput) => Promise<TEntity>;
  update: (id: string, input: TUpdateInput) => Promise<TEntity>;
  remove: (id: string) => Promise<null>;
}

export interface CrudQueryHooksOptions {
  /**
   * Reference data changes rarely and is reused across many screens —
   * default 5 minutes (vs. QueryProvider's global 30s) to avoid
   * refetching on every navigation. Override per-entity if one of them
   * turns out to change more often.
   */
  staleTimeMs?: number;
}

export function createCrudQueryHooks<
  TEntity extends { id: string },
  TListParams extends object,
  TCreateInput,
  TUpdateInput,
>(
  queryKeyPrefix: string,
  sdk: CrudSdk<TEntity, TListParams, TCreateInput, TUpdateInput>,
  options: CrudQueryHooksOptions = {},
) {
  const staleTime = options.staleTimeMs ?? 5 * 60 * 1000;

  const keys = {
    all: [queryKeyPrefix] as const,
    lists: () => [...keys.all, "list"] as const,
    list: (params: TListParams) => [...keys.lists(), params] as const,
    details: () => [...keys.all, "detail"] as const,
    detail: (id: string) => [...keys.details(), id] as const,
  };

  function useListQuery(params: TListParams) {
    return useQuery({
      queryKey: keys.list(params),
      queryFn: () => sdk.list(params),
      staleTime,
      placeholderData: (previousData) => previousData,
    });
  }

  function useDetailQuery(id: string | undefined) {
    return useQuery({
      queryKey: keys.detail(id ?? ""),
      queryFn: () => sdk.get(id as string),
      staleTime,
      enabled: !!id,
    });
  }

  function useInvalidate() {
    const queryClient = useQueryClient();
    return (entity?: TEntity) => {
      queryClient.invalidateQueries({ queryKey: keys.lists() });
      if (entity) queryClient.invalidateQueries({ queryKey: keys.detail(entity.id) });
    };
  }

  function useCreateMutation() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: (input: TCreateInput) => sdk.create(input),
      onSuccess: (entity) => invalidate(entity),
    });
  }

  function useUpdateMutation() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: TUpdateInput }) => sdk.update(id, input),
      onSuccess: (entity) => invalidate(entity),
    });
  }

  function useDeleteMutation() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: (id: string) => sdk.remove(id),
      onSuccess: () => invalidate(),
    });
  }

  return { keys, useListQuery, useDetailQuery, useCreateMutation, useUpdateMutation, useDeleteMutation };
}
