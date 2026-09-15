/**
 * Deliberately restrained elevation scale — enterprise surfaces mostly
 * separate with a 1px border (see themes/components.ts), shadows are
 * reserved for genuinely floating surfaces: menus, popovers, dialogs, drawers.
 */
export const shadowsLight = {
  none: "none",
  xs: "0 1px 2px rgba(16, 24, 40, 0.06)",
  sm: "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
  md: "0 4px 8px -2px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06)",
  lg: "0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)",
  xl: "0 20px 24px -4px rgba(16, 24, 40, 0.08), 0 8px 8px -4px rgba(16, 24, 40, 0.03)",
} as const;

export const shadowsDark = {
  none: "none",
  xs: "0 1px 2px rgba(0, 0, 0, 0.24)",
  sm: "0 1px 3px rgba(0, 0, 0, 0.32), 0 1px 2px rgba(0, 0, 0, 0.24)",
  md: "0 4px 8px -2px rgba(0, 0, 0, 0.36), 0 2px 4px -2px rgba(0, 0, 0, 0.24)",
  lg: "0 12px 16px -4px rgba(0, 0, 0, 0.40), 0 4px 6px -2px rgba(0, 0, 0, 0.24)",
  xl: "0 20px 24px -4px rgba(0, 0, 0, 0.44), 0 8px 8px -4px rgba(0, 0, 0, 0.24)",
} as const;

export const shadowTokens = { shadowsLight, shadowsDark } as const;
