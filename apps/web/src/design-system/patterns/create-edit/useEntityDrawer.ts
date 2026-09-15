import { useState } from "react";

interface EntityDrawerState<T> {
  open: boolean;
  /** The record being edited, or null when creating a new one. */
  editing: T | null;
  openCreate: () => void;
  openEdit: (entity: T) => void;
  close: () => void;
}

/**
 * The standard state shape behind the create/edit pattern's FormDrawer:
 * one hook drives both "Create" (editing = null) and "Edit" (editing =
 * the row) so pages don't duplicate that branching.
 */
export function useEntityDrawer<T>(): EntityDrawerState<T> {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);

  return {
    open,
    editing,
    openCreate: () => {
      setEditing(null);
      setOpen(true);
    },
    openEdit: (entity: T) => {
      setEditing(entity);
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}
