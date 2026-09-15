import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import Collapse from "@mui/material/Collapse";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useMemo, useState, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { PermissionGate } from "@/shared/components/PermissionGate";
import type { NavigationItem } from "@/shared/types/navigation";

interface SidebarNavItemProps {
  item: NavigationItem;
  collapsed: boolean;
  depth?: number;
  onNavigate?: () => void;
}

function isDescendantActive(item: NavigationItem, pathname: string): boolean {
  if (item.path && pathname.startsWith(item.path)) return true;
  return item.children?.some((child) => isDescendantActive(child, pathname)) ?? false;
}

export function SidebarNavItem({ item, collapsed, depth = 0, onNavigate }: SidebarNavItemProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hasChildren = !!item.children?.length;
  const active = useMemo(() => isDescendantActive(item, location.pathname), [item, location.pathname]);
  const [expanded, setExpanded] = useState(active);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  if (item.visible === false) return null;

  const Icon = item.icon;

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (hasChildren && collapsed && depth === 0) {
      setMenuAnchor(event.currentTarget);
      return;
    }
    if (hasChildren) {
      setExpanded((prev) => !prev);
      return;
    }
    if (item.path) {
      navigate(item.path);
      onNavigate?.();
    }
  };

  const button = (
    <ListItemButton
      selected={active && !hasChildren}
      onClick={handleClick}
      sx={{
        borderRadius: 1.5,
        mx: 1,
        pl: collapsed ? 1.5 : 1.5 + depth * 1.5,
        justifyContent: collapsed && depth === 0 ? "center" : "flex-start",
        color: active ? "primary.main" : "text.secondary",
        "&.Mui-selected": {
          backgroundColor: "action.selected",
          color: "primary.main",
        },
      }}
      aria-current={active && !hasChildren ? "page" : undefined}
      aria-haspopup={hasChildren && collapsed && depth === 0 ? "menu" : undefined}
      aria-expanded={
        !hasChildren ? undefined : collapsed && depth === 0 ? !!menuAnchor : expanded
      }
      aria-controls={hasChildren && !(collapsed && depth === 0) ? `${item.id}-submenu` : undefined}
    >
      {Icon ? (
        <ListItemIcon sx={{ minWidth: 0, mr: collapsed && depth === 0 ? 0 : 1.5, color: "inherit" }}>
          <Icon fontSize="small" />
        </ListItemIcon>
      ) : depth > 0 ? (
        <ListItemIcon sx={{ minWidth: 0, mr: 1.5, color: "inherit" }}>
          <FiberManualRecordIcon sx={{ fontSize: 6 }} />
        </ListItemIcon>
      ) : null}
      {(!collapsed || depth > 0) && (
        <ListItemText
          primary={item.label}
          slotProps={{ primary: { fontSize: "0.875rem", fontWeight: active ? 600 : 500 } }}
        />
      )}
      {!collapsed && hasChildren && depth === 0 ? (expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />) : null}
    </ListItemButton>
  );

  return (
    <PermissionGate permission={item.permission} anyOf={item.anyOfPermissions}>
      <li>
        {collapsed && depth === 0 ? (
          <Tooltip title={item.label} placement="right">
            {button}
          </Tooltip>
        ) : (
          button
        )}

        {hasChildren && !collapsed && (
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <ul id={`${item.id}-submenu`} role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {item.children!.map((child) => (
                <SidebarNavItem key={child.id} item={child} collapsed={false} depth={depth + 1} onNavigate={onNavigate} />
              ))}
            </ul>
          </Collapse>
        )}

        {hasChildren && collapsed && depth === 0 && (
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "right" }}>
            {item.children!.map((child) => (
              <MenuItem
                key={child.id}
                selected={!!child.path && location.pathname.startsWith(child.path)}
                onClick={() => {
                  if (child.path) navigate(child.path);
                  setMenuAnchor(null);
                  onNavigate?.();
                }}
              >
                {child.label}
              </MenuItem>
            ))}
          </Menu>
        )}
      </li>
    </PermissionGate>
  );
}
