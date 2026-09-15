import type { UseMutationResult } from "@tanstack/react-query";

import { useNotify } from "@/app/providers/NotificationProvider";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { getApiErrorMessage } from "@/shared/api";

export interface UseReferenceDataDeleteOptions<TEntity extends { id: string }> {
  entityLabel: string;
  getDisplayName: (entity: TEntity) => string;
  useDeleteMutation: () => UseMutationResult<null, unknown, string>;
}

/** Confirm + delete + notify for any reference-data entity — shared across domains' list/details pages. */
export function useReferenceDataDelete<TEntity extends { id: string }>({
  entityLabel,
  getDisplayName,
  useDeleteMutation,
}: UseReferenceDataDeleteOptions<TEntity>) {
  const confirm = useConfirm();
  const notify = useNotify();
  const deleteMutation = useDeleteMutation();

  return async (entity: TEntity): Promise<boolean> => {
    const name = getDisplayName(entity);
    const confirmed = await confirm({
      title: `Delete ${name}?`,
      description: `This ${entityLabel.toLowerCase()} will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return false;

    try {
      await deleteMutation.mutateAsync(entity.id);
      notify({ message: `${name} deleted`, severity: "success" });
      return true;
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
      return false;
    }
  };
}
