import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { useTenant } from "@/app/providers/TenantProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { KpiCard } from "@/design-system/components/KpiCard";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getEventTypeLabel } from "@/features/security-audit/eventTypeMeta";
import { useLoginAttemptsQuery, useSecurityEventsQuery } from "@/features/security-audit/hooks";
import { useTenantMembershipsQuery } from "@/features/memberships/hooks";
import { useMyProductEntitlementsQuery } from "@/features/product-entitlements/hooks";
import { useUsersQuery } from "@/features/users/hooks";
import { useOrganizationsQuery } from "@/features/organizations/hooks";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { getApiErrorMessage } from "@/shared/api";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { useRoleContext } from "@/shared/auth/useRoleContext";

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

/**
 * Real metrics only — every tile below is a direct `meta.total` (or a
 * direct count of an already-tenant-scoped list) from a real endpoint this
 * user is already permitted to call; nothing here is a client-side
 * aggregate across several requests, and nothing is fabricated. There is no
 * platform-wide-Users, platform-wide-Organizations, or single-call
 * adoption/activity-rate metric this backend can produce — none is shown.
 * `PermissionGate` hides a tile entirely rather than showing a 403 — the
 * same discipline the Platform Console's own dashboard uses (see
 * docs/PHASE_2UI3.md).
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { businessLabel } = useRoleContext();

  const usersQuery = useUsersQuery({ limit: 1 });
  const organizationsQuery = useOrganizationsQuery({ limit: 1 });
  const activeMembershipsQuery = useTenantMembershipsQuery({ status: "ACTIVE", limit: 1 });
  const pendingInvitationsQuery = useTenantMembershipsQuery({ status: "INVITED", limit: 1 });
  const entitlementsQuery = useMyProductEntitlementsQuery();
  const securityEventsQuery = useSecurityEventsQuery({ limit: 5 });
  const loginAttemptsQuery = useLoginAttemptsQuery({ limit: 5 });

  const enabledProductCount = entitlementsQuery.data?.filter((e) => e.status === "ACTIVE").length;

  return (
    <>
      <PageHeader
        title={`Welcome back${user ? `, ${user.displayName.split(" ")[0]}` : ""}`}
        description={tenant ? `${businessLabel} · ${tenant.name}` : businessLabel}
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <PermissionGate permission={PERMISSIONS.USER_VIEW}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard label="Users" value={usersQuery.data?.meta.total} loading={usersQuery.isLoading} onClick={() => navigate("/users")} />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.ORGANIZATION_MANAGE}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard
              label="Organizations"
              value={organizationsQuery.data?.meta.total}
              loading={organizationsQuery.isLoading}
              onClick={() => navigate("/organizations")}
            />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.USER_VIEW}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard
              label="Active memberships"
              value={activeMembershipsQuery.data?.meta.total}
              loading={activeMembershipsQuery.isLoading}
              onClick={() => navigate("/memberships")}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard
              label="Pending invitations"
              value={pendingInvitationsQuery.data?.meta.total}
              loading={pendingInvitationsQuery.isLoading}
              caption={(pendingInvitationsQuery.data?.meta.total ?? 0) > 0 ? "Needs attention" : undefined}
              onClick={() => navigate("/invitations")}
            />
          </Grid>
        </PermissionGate>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            label="Products enabled"
            value={enabledProductCount}
            loading={entitlementsQuery.isLoading}
            onClick={() => navigate("/product-entitlements")}
          />
        </Grid>
      </Grid>

      <PermissionGate permission={PERMISSIONS.SECURITY_AUDIT_VIEW}>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardHeader title="Recent security events" subheader="Are there security issues that need attention?" />
              {securityEventsQuery.isLoading ? (
                <CardContent>
                  <LoadingState dense />
                </CardContent>
              ) : securityEventsQuery.isError ? (
                <CardContent>
                  <ErrorState dense description={getApiErrorMessage(securityEventsQuery.error)} onRetry={() => securityEventsQuery.refetch()} />
                </CardContent>
              ) : !securityEventsQuery.data || securityEventsQuery.data.items.length === 0 ? (
                <CardContent>
                  <EmptyState variant="no-data" title="No recent security events" dense />
                </CardContent>
              ) : (
                <List disablePadding>
                  {securityEventsQuery.data.items.map((event) => (
                    <ListItem key={event.id} divider>
                      <ListItemText primary={getEventTypeLabel(event.eventType)} secondary={new Date(event.createdAt).toLocaleString()} />
                    </ListItem>
                  ))}
                </List>
              )}
              <CardActionArea onClick={() => navigate("/security/audit-events")} sx={{ p: 1.5 }}>
                <Typography variant="body2" color="primary">
                  View all security events
                </Typography>
              </CardActionArea>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardHeader title="Recent login attempts" />
              {loginAttemptsQuery.isLoading ? (
                <CardContent>
                  <LoadingState dense />
                </CardContent>
              ) : loginAttemptsQuery.isError ? (
                <CardContent>
                  <ErrorState dense description={getApiErrorMessage(loginAttemptsQuery.error)} onRetry={() => loginAttemptsQuery.refetch()} />
                </CardContent>
              ) : !loginAttemptsQuery.data || loginAttemptsQuery.data.items.length === 0 ? (
                <CardContent>
                  <EmptyState variant="no-data" title="No recent login attempts" dense />
                </CardContent>
              ) : (
                <List disablePadding>
                  {loginAttemptsQuery.data.items.map((attempt) => (
                    <ListItem key={attempt.id} divider>
                      <ListItemText
                        primary={attempt.identifier}
                        secondary={`${attempt.success ? "Succeeded" : `Failed${attempt.failureReason ? ` — ${attempt.failureReason}` : ""}`} · ${new Date(attempt.createdAt).toLocaleString()}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
              <CardActionArea onClick={() => navigate("/security/audit-events")} sx={{ p: 1.5 }}>
                <Typography variant="body2" color="primary">
                  View all login attempts
                </Typography>
              </CardActionArea>
            </Card>
          </Grid>
        </Grid>
      </PermissionGate>

      <Grid container spacing={2}>
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
              description="Search the full event and login-attempt history."
              onClick={() => navigate("/security/audit-events")}
            />
          </Grid>
        </PermissionGate>
        <PermissionGate permission={PERMISSIONS.TENANT_MANAGE}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <QuickLinkCard
              icon={TuneOutlinedIcon}
              label="Tenant Settings"
              description="This tenant's own registration profile."
              onClick={() => navigate("/tenant-settings")}
            />
          </Grid>
        </PermissionGate>
      </Grid>
    </>
  );
}
