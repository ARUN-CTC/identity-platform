import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useState, type MouseEvent } from "react";

import { EmptyState } from "@/design-system/components/EmptyState";

/**
 * Phase 1 UX remediation, Finding 3: this used to be static/hardcoded
 * content — the same "2 notifications" and the same two messages appeared
 * for every account regardless of tenant or history, including a
 * brand-new account seconds old. Confirmed live and judged worse than no
 * notifications at all (a user reasonably believes there's something real
 * to check and is wrong). No Notifications backend exists yet (every
 * module under apps/backend/.../products/travel/notifications/ is an
 * empty stub, no DB model) — until one does, this stays genuinely empty
 * rather than fake. The empty-state branch below already existed and is
 * now what every account actually sees.
 */
const NOTIFICATIONS: { id: string; title: string; time: string }[] = [];

export function NotificationMenu() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <IconButton onClick={handleOpen} aria-haspopup="menu" aria-expanded={!!anchorEl} aria-label="Notifications">
        <Badge badgeContent={NOTIFICATIONS.length} color="error" overlap="circular">
          <NotificationsOutlinedIcon fontSize="small" />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Box sx={{ px: 2, py: 1, minWidth: 320 }}>
          <Typography variant="body2" fontWeight={600}>
            Notifications
          </Typography>
        </Box>
        <Divider />
        {NOTIFICATIONS.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <EmptyState variant="no-data" title="No notifications" description="You're all caught up." dense />
          </Box>
        ) : (
          NOTIFICATIONS.map((notification) => (
            <MenuItem key={notification.id} onClick={handleClose} sx={{ whiteSpace: "normal" }}>
              <Box>
                <Typography variant="body2">{notification.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {notification.time}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}
