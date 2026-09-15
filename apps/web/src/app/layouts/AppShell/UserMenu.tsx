import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { useTenant } from "@/app/providers/TenantProvider";
import { useRoleContext } from "@/shared/auth/useRoleContext";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const { tenant } = useTenant();
  const { businessLabel } = useRoleContext();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (!user) return null;

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Box
        component="button"
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={!!anchorEl}
        aria-label="Account menu"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          border: "none",
          background: "none",
          cursor: "pointer",
          borderRadius: 999,
          p: 0.25,
        }}
      >
        <Avatar sx={{ width: 32, height: 32, fontSize: "0.8125rem" }}>{user.initials}</Avatar>
      </Box>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Box sx={{ px: 2, py: 1.25, minWidth: 220 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {user.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {user.email}
          </Typography>
          <Typography variant="caption" color="text.disabled" noWrap component="div">
            {businessLabel}
          </Typography>
          {tenant && (
            <Typography variant="caption" color="text.disabled" noWrap component="div">
              {tenant.name}
            </Typography>
          )}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            handleClose();
            navigate("/settings");
          }}
        >
          <ListItemIcon>
            <SettingsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Settings
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            handleClose();
            // An intentional logout must land on /login clean, not silently
            // reopen whatever page the user was on before. Navigating here,
            // synchronously, before signOut()'s state actually clears (it
            // awaits a network call first) means this route change always
            // wins — ProtectedRoute never gets a chance to run its own
            // reactive `state.from` capture against the page we're leaving.
            navigate("/login", { replace: true });
            void signOut();
          }}
        >
          <ListItemIcon>
            <LogoutOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
