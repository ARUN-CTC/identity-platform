import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createApplication,
  getPlatformApplication,
  listApplicationsForProduct,
  updatePlatformApplication,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from "@/shared/platform-api";

const keys = {
  forProduct: (productId: string) => ["platform", "products", productId, "applications"] as const,
  detail: (id: string) => ["platform", "applications", id] as const,
};

export function useApplicationsForProductQuery(productId: string | undefined) {
  return useQuery({
    queryKey: keys.forProduct(productId ?? ""),
    queryFn: () => listApplicationsForProduct(productId as string, { limit: 100 }),
    enabled: !!productId,
  });
}

export function usePlatformApplicationQuery(id: string | undefined) {
  return useQuery({ queryKey: keys.detail(id ?? ""), queryFn: () => getPlatformApplication(id as string), enabled: !!id });
}

export function useCreateApplicationMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApplicationInput) => createApplication(productId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.forProduct(productId) }),
  });
}

export function useUpdateApplicationMutation(id: string, productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateApplicationInput) => updatePlatformApplication(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.detail(id) });
      queryClient.invalidateQueries({ queryKey: keys.forProduct(productId) });
    },
  });
}
