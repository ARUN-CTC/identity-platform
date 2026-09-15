import MenuIcon from "@mui/icons-material/Menu";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";

import { GlobalSearchField } from "@/design-system/components/GlobalSearchField";
import { layoutSpacing } from "@/design-system/tokens/spacing";

import { NotificationMenu } from "./NotificationMenu";
import { OrganizationContextSwitcher } from "./OrganizationContextSwitcher";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { UserMenu } from "./UserMenu";

interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  return (
    <AppBar position="sticky" sx={{ height: layoutSpacing.topbarHeight }}>
      <Toolbar sx={{ height: "100%", minHeight: "100% !important", gap: 1.5 }}>
        <IconButton
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          sx={{ display: { xs: "inline-flex", lg: "none" } }}
        >
          <MenuIcon />
        </IconButton>

        <GlobalSearchField />

        <Box sx={{ flex: 1 }} />

        <Stack direction="row" alignItems="center" spacing={1}>
          <OrganizationContextSwitcher />
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.5}>
          <ThemeModeToggle />
          <NotificationMenu />
          <UserMenu />
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
