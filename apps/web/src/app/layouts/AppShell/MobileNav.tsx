import Drawer from "@mui/material/Drawer";

import { layoutSpacing } from "@/design-system/tokens/spacing";

import { SidebarContent } from "./Sidebar";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  return (
    <Drawer
      variant="temporary"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        display: { xs: "block", lg: "none" },
        "& .MuiDrawer-paper": { width: layoutSpacing.sidebarWidthExpanded, boxSizing: "border-box" },
      }}
    >
      <SidebarContent collapsed={false} onToggleCollapsed={onClose} onNavigate={onClose} />
    </Drawer>
  );
}
