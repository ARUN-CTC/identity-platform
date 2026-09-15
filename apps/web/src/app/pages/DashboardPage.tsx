import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/design-system/components/PageHeader";
import { useAuth } from "@/app/providers/AuthProvider";
import { useTenant } from "@/app/providers/TenantProvider";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { useRoleContext } from "@/shared/auth/useRoleContext";

/**
 * Phase 1 placeholder — deliberately minimal, real content only (no
 * fabricated counts/charts): a welcome header plus links into whichever
 * administration areas this user's real permissions actually grant. Each
 * destination is a PlaceholderPage today (see routes.tsx) pending its own
 * build-out; this page's own job is just to prove the authenticated shell
 * — session, permissions, navigation — works end-to-end.
 */
function QuickLinkCard({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: ComponentType<{ fontSize?: "medium"; color?: "action" }>;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardActionArea onClick={onClick} sx={{ height: "100%" }}>
        <CardContent>
          <Stack spacing={1}>
            <Icon color="action" />
            <Typography variant="h5">{label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { businessLabel } = useRoleContext();

  return (
    <>
      <PageHeader
        title={`Welcome back${user ? `, ${user.displayName.split(" ")[0]}` : ""}`}
        description={tenant ? `${businessLabel} · ${tenant.name}` : businessLabel}
      />

      <Grid container spacing={2}>
        <PermissionGate permission={PERMISSIONS.USER_VIEW}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <QuickLinkCard
              icon={GroupOutlinedIcon}
              label="Users"
              description="View and manage users in this tenant."
              onClick={() => navigate("/users")}
            />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.ORGANIZATION_MANAGE}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <QuickLinkCard
              icon={ApartmentOutlinedIcon}
              label="Organizations"
              description="Manage organizations and units."
              onClick={() => navigate("/organizations")}
            />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.ROLE_VIEW}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <QuickLinkCard
              icon={AdminPanelSettingsOutlinedIcon}
              label="Roles & Permissions"
              description="Review roles and their grants."
              onClick={() => navigate("/roles")}
            />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.SECURITY_AUDIT_VIEW}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <QuickLinkCard
              icon={HistoryOutlinedIcon}
              label="Security & Audit"
              description="Review security and authentication events."
              onClick={() => navigate("/security/audit-events")}
            />
          </Grid>
        </PermissionGate>
      </Grid>
    </>
  );
}
