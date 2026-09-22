import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { platformNavigation } from "../navigation";
import { usePlatformAuth } from "../providers/PlatformAuthProvider";

const DRAWER_WIDTH = 260;

/**
 * The Platform Console's own shell — deliberately NOT the tenant AppShell
 * (different AppBar color, a persistent "PLATFORM OPERATOR" badge, no
 * organization-context switcher, no tenant/platform toggle of any kind).
 * A Platform Operator navigating here must never be able to mistake this
 * for their tenant account, and there is no control anywhere in this tree
 * to move between the two boundaries — signing out and signing back in as
 * a tenant user is the only way, exactly mirroring the backend's own
 * separate authentication mechanisms.
 */
export function PlatformShell() {
  const { operator, hasPlatformPermission, signOut } = usePlatformAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/platform-console/login", { replace: true });
  };

  const visibleSections = platformNavigation
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.permission || hasPlatformPermission(item.permission)) }))
    .filter((section) => section.items.length > 0);

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        color="default"
        elevation={0}
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, borderBottom: 1, borderColor: "divider", bgcolor: "grey.900", color: "common.white" }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <ShieldOutlinedIcon />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
            Platform Console
          </Typography>
          <Chip label="PLATFORM OPERATOR" size="small" color="warning" variant="filled" />
          {operator && (
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              {operator.email}
            </Typography>
          )}
          <Tooltip title="Sign out">
            <IconButton onClick={handleSignOut} aria-label="Sign out" sx={{ color: "inherit" }}>
              <LogoutOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        <Toolbar />
        <List sx={{ pt: 1 }}>
          {visibleSections.map((section, index) => (
            <Fragment key={section.label ?? `section-${index}`}>
              {section.label && (
                <ListSubheader component="div" sx={{ bgcolor: "transparent", lineHeight: "32px", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {section.label}
                </ListSubheader>
              )}
              {section.items.map((item) => (
                <ListItemButton
                  key={item.id}
                  component={NavLink}
                  to={item.path}
                  end={item.path === "/platform-console"}
                  sx={{ "&.active": { bgcolor: "action.selected", borderRight: 3, borderColor: "warning.main" } }}
                >
                  <ListItemIcon>
                    <item.icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                  {item.apiGap && (
                    <Tooltip title="Backend API required — see docs/PHASE_2UI3.md">
                      <Chip label="soon" size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    </Tooltip>
                  )}
                </ListItemButton>
              ))}
            </Fragment>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <Stack sx={{ maxWidth: 1200, mx: "auto", px: { xs: 2, sm: 3 }, py: 3 }}>
          <Outlet />
        </Stack>
      </Box>
    </Box>
  );
}
