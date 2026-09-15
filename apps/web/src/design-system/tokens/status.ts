import { amber, blue, green, neutral, red, teal, violet } from "./colors";

/**
 * Semantic status colors shared by every domain's entity lifecycle
 * (tenants, organizations, users, bookings, ...). Components must consume
 * these through `theme.palette.status.*` (see themes/light.ts and dark.ts)
 * rather than importing this file directly, and must never encode status
 * meaning via color alone — always pair with a label/icon (see StatusBadge).
 */
export const statusColorTokens = {
  draft: neutral[500],
  pending: amber[500],
  active: green[500],
  inactive: neutral[400],
  suspended: red[400],
  approved: green[600],
  rejected: red[600],
  failed: red[700],
  completed: teal[600],
  cancelled: neutral[600],
  archived: violet[400],
  info: blue[500],
  // Added for the "in flight, awaiting an outcome" family (e.g. Inquiry
  // OPEN, Quotation SENT) — distinct from `active`, which is overwhelmingly
  // used tenant-wide for "healthy/enabled" (User/Organization/Tenant/
  // WhatsApp/Email/Customer/Traveler ACTIVE, 13+ call sites) and must stay
  // green. Conflating the two under `active` was the one real cross-domain
  // status inconsistency found in the design-system audit — see
  // SEMANTIC_TONE below and docs/architecture.md's "Status semantic model".
  inProgress: blue[500],
} as const;

export type StatusKey = keyof typeof statusColorTokens;

/**
 * The five semantic treatments every StatusKey collapses into — this is
 * the canonical reference for picking a StatusKey when a new domain status
 * is added, not a separate rendering path (StatusBadge/getStatusMeta still
 * read `statusColorTokens` directly). Kept in sync by convention: adding a
 * StatusKey without adding it here is a lint-invisible but real
 * documentation gap, so review this table whenever `statusColorTokens`
 * changes.
 *
 *   Neutral      — draft, inactive, cancelled, archived
 *   Informational — info, inProgress
 *   Warning      — pending, suspended
 *   Success      — active, approved, completed
 *   Error        — rejected, failed
 */
export const SEMANTIC_TONE: Record<StatusKey, "neutral" | "info" | "warning" | "success" | "error"> = {
  draft: "neutral",
  inactive: "neutral",
  cancelled: "neutral",
  archived: "neutral",
  info: "info",
  inProgress: "info",
  pending: "warning",
  suspended: "warning",
  active: "success",
  approved: "success",
  completed: "success",
  rejected: "error",
  failed: "error",
};
