/**
 * Reference values for one-off `sx={{ zIndex: ... }}` needs above the shell
 * (e.g. a custom overlay). These are NOT wired into `theme.zIndex.drawer`/
 * `.appBar` — MUI's own defaults there (drawer 1200 > appBar 1100) are what
 * make FormDrawer/MobileNav render above the sticky Topbar; overriding them
 * previously inverted that relationship and hid every Drawer's header
 * behind the Topbar. Leave `theme.zIndex.drawer`/`.appBar` alone.
 */
export const zIndex = {
  mobileNavBackdrop: 1250,
  notificationPanel: 1300,
} as const;

export const zIndexTokens = { zIndex } as const;
