import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { navigationSections } from "@/app/router/navigation";
import { usePermissionContext } from "@/app/providers/PermissionProvider";
import { layoutSpacing } from "@/design-system/tokens/spacing";
import { isNavItemVisible } from "@/shared/types/navigation";

import { SidebarNavItem } from "./SidebarNavItem";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
}

export function SidebarContent({ collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const { hasPermission, hasAnyPermission } = usePermissionContext();
  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemVisible(item, { hasPermission, hasAnyPermission })),
    }))
    // A section with zero visible items would otherwise render a bare,
    // empty uppercase caption above nothing.
    .filter((section) => section.items.length > 0);

  return (
    <Stack component="nav" aria-label="Primary" sx={{ height: "100%" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        sx={{ height: layoutSpacing.topbarHeight, px: collapsed ? 0 : 2, flexShrink: 0 }}
      >
        {!collapsed && (
          <Stack sx={{ lineHeight: 1.15 }}>
            <Typography variant="h5" component="span" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
              Identity Platform
            </Typography>
            {/* The tenant-side counterpart to the Platform Console's own
                "Platform Console" + "PLATFORM OPERATOR" chip branding
                (platform-console/layout/PlatformShell.tsx) — lighter-weight
                here since this is the default, lower-privilege surface, but
                still an explicit, unmissable "which console am I in" signal
                (brief §27), never left to be inferred from the URL alone. */}
            <Typography variant="caption" component="span" color="text.secondary">
              Tenant Administration
            </Typography>
          </Stack>
        )}
        <IconButton
          onClick={onToggleCollapsed}
          size="small"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          sx={{ display: { xs: "none", lg: "inline-flex" } }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
        </IconButton>
      </Stack>

      <Divider />

      <Box component="ul" sx={{ listStyle: "none", m: 0, py: 1, flex: 1, overflowY: "auto" }}>
        {visibleSections.map((section, index) => (
          <Box key={section.id} component="li" sx={{ mb: 0.5 }}>
            {section.label && !collapsed && (
              <Typography
                variant="label"
                component="div"
                sx={{ px: 2.5, pt: index === 0 ? 0 : 1.5, pb: 0.5, color: "text.disabled", textTransform: "uppercase" }}
              >
                {section.label}
              </Typography>
            )}
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {section.items.map((item) => (
                <SidebarNavItem key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
