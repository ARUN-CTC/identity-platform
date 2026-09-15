import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";

import { LoadingState } from "@/design-system/components/LoadingState";
import { layoutSpacing } from "@/design-system/tokens/spacing";

import { PageContainer } from "@/app/layouts/PageContainer";
import { BreadcrumbLabelProvider } from "@/app/router/BreadcrumbLabel";

import { MobileNav } from "./MobileNav";
import { SidebarContent } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useSidebarCollapsed } from "./useSidebarState";

export function AppShell() {
  const { collapsed, toggle } = useSidebarCollapsed();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const sidebarWidth = collapsed ? layoutSpacing.sidebarWidthCollapsed : layoutSpacing.sidebarWidthExpanded;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", lg: "block" },
          width: sidebarWidth,
          flexShrink: 0,
          transition: (theme) => theme.transitions.create("width"),
          "& .MuiDrawer-paper": {
            width: sidebarWidth,
            boxSizing: "border-box",
            transition: (theme) => theme.transitions.create("width"),
            overflowX: "hidden",
          },
        }}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapsed={toggle} />
      </Drawer>

      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <Box component="main" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <BreadcrumbLabelProvider>
          <PageContainer>
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </PageContainer>
        </BreadcrumbLabelProvider>
      </Box>
    </Box>
  );
}
