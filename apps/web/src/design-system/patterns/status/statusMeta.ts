import { statusColorTokens, type StatusKey } from "@/design-system/tokens/status";

export interface StatusMeta {
  key: StatusKey;
  label: string;
  color: string;
}

/**
 * Non-component status lookup — for DataGrid `renderCell`, CSV/export
 * generation, or anywhere a React component (StatusBadge) can't be used
 * directly but the same status→label/color mapping must stay in sync.
 */
export function getStatusMeta(status: StatusKey): StatusMeta {
  // Handles camelCase keys (e.g. "inProgress" → "In Progress"), matching
  // StatusBadge's own default-label logic — kept in sync deliberately,
  // not re-derived from one another (see that component's own comment).
  const spaced = status.replace(/([a-z])([A-Z])/g, "$1 $2");
  return {
    key: status,
    label: spaced.charAt(0).toUpperCase() + spaced.slice(1),
    color: statusColorTokens[status],
  };
}

export const ALL_STATUS_KEYS = Object.keys(statusColorTokens) as StatusKey[];
