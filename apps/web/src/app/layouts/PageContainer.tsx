import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { Breadcrumbs } from "@/design-system/components/Breadcrumbs";
import { layoutSpacing } from "@/design-system/tokens/spacing";

import { useBreadcrumbLabelValue } from "@/app/router/BreadcrumbLabel";
import { useBreadcrumbs } from "@/app/router/useBreadcrumbs";

/**
 * The content-area shell every routed page renders inside: fixed max-width,
 * consistent padding, and the auto-derived breadcrumb trail. AppShell is the
 * only place that mounts this — domain pages just render their
 * PageHeader/content and get this wrapper "for free" via the Outlet.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  const currentLabel = useBreadcrumbLabelValue();
  const breadcrumbItems = useBreadcrumbs(currentLabel);

  return (
    <Box
      sx={{
        flex: 1,
        maxWidth: layoutSpacing.pageContainerMaxWidth,
        width: "100%",
        mx: "auto",
        px: { xs: 2, sm: 3 },
        py: 3,
      }}
    >
      <Breadcrumbs items={breadcrumbItems} />
      {children}
    </Box>
  );
}
