import MenuIcon from "@mui/icons-material/Menu";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import { useAuth } from "@/app/providers/AuthProvider";
import { useTenant } from "@/app/providers/TenantProvider";
import { GlobalSearchField } from "@/design-system/components/GlobalSearchField";
import { layoutSpacing } from "@/design-system/tokens/spacing";

import { NotificationMenu } from "./NotificationMenu";
import { OrganizationContextSwitcher } from "./OrganizationContextSwitcher";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { UserMenu } from "./UserMenu";

/**
 * The persistent "which tenant/organization am I operating in" indicator
 * (brief §28) — the tenant name was previously only visible inside
 * UserMenu's dropdown, easy to lose track of when a caller holds
 * organization-scoped grants across more than one context. `tenant` is
 * always the caller's own, JWT-derived tenant (TenantProvider) — never a
 * value this component could substitute another one into.
 */
function TenantContextIndicator() {
  const { tenant } = useTenant();
  const { organizationContext } = useAuth();
  if (!tenant) return null;

  return (
    <Stack sx={{ display: { xs: "none", sm: "flex" }, lineHeight: 1.1, minWidth: 0 }}>
      <Typography variant="body2" fontWeight={600} noWrap title={tenant.name}>
        {tenant.name}
      </Typography>
      {organizationContext && (
        <Typography variant="caption" color="text.secondary" noWrap title={organizationContext.name}>
          {organizationContext.name}
        </Typography>
      )}
    </Stack>
  );
}

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

        <TenantContextIndicator />
        <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", sm: "block" }, my: 1.5 }} />

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
