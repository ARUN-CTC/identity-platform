import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createPlatformProduct, getPlatformProduct, listPlatformProducts, updatePlatformProduct, type CreateProductInput, type UpdateProductInput } from "@/shared/platform-api";
import type { ListParams } from "@/shared/api";

const keys = {
  all: ["platform", "products"] as const,
  lists: () => [...keys.all, "list"] as const,
  list: (params: ListParams) => [...keys.lists(), params] as const,
  detail: (id: string) => [...keys.all, "detail", id] as const,
};

export function usePlatformProductsQuery(params: ListParams) {
  return useQuery({ queryKey: keys.list(params), queryFn: () => listPlatformProducts(params), placeholderData: (p) => p });
}

export function usePlatformProductQuery(id: string | undefined) {
  return useQuery({ queryKey: keys.detail(id ?? ""), queryFn: () => getPlatformProduct(id as string), enabled: !!id });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: keys.lists() });
    if (id) queryClient.invalidateQueries({ queryKey: keys.detail(id) });
  };
}

export function useCreatePlatformProductMutation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateProductInput) => createPlatformProduct(input), onSuccess: () => invalidate() });
}

export function useUpdatePlatformProductMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: UpdateProductInput) => updatePlatformProduct(id, input), onSuccess: () => invalidate(id) });
}
