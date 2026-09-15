/**
 * 8px base spacing unit. MUI's `theme.spacing(n)` multiplies this base,
 * so components should always call `theme.spacing(n)` rather than reading
 * this constant directly.
 */
export const spacingBaseUnit = 8;

export const layoutSpacing = {
  sidebarWidthExpanded: 264,
  sidebarWidthCollapsed: 72,
  topbarHeight: 60,
  pageContainerMaxWidth: 1600,
  pageContainerPaddingX: 24,
  pageContainerPaddingY: 24,
} as const;

export const spacingTokens = { spacingBaseUnit, layoutSpacing } as const;
