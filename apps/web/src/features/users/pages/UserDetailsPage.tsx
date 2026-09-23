import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState, type SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useBreadcrumbLabel } from "@/app/router/BreadcrumbLabel";
import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { getMembershipStatusMeta } from "@/features/organizations/statusMeta";
import { useTenantMembershipsQuery } from "@/features/memberships/hooks";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage } from "@/shared/api";

import { AssignRoleDialog } from "../AssignRoleDialog";
import { getUserStatusMeta } from "../statusMeta";
import { UserLifecycleActions } from "../UserLifecycleActions";
import { useDeleteUserMutation, useRevokeRoleMutation, useUserQuery, useUserRolesQuery } from "../hooks";

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function UserDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const [tab, setTab] = useState(0);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);

  const userQuery = useUserQuery(id);
  const rolesQuery = useUserRolesQuery(id);
  const deleteMutation = useDeleteUserMutation();
  const revokeRoleMutation = useRevokeRoleMutation(id ?? "");
  // This user's own memberships within the CURRENT tenant only — the
  // Global User <-> Membership <-> Tenant model (see docs/PHASE_2UI4.md,
  // brief §6): this page must never imply the user "belongs to" this
  // tenant exclusively, and GET /memberships is itself tenant-scoped
  // server-side, so a foreign-tenant membership could never appear here
  // even if one existed.
  const membershipsQuery = useTenantMembershipsQuery({ userId: id, limit: 100 }, !!id);

  const displayName = userQuery.data
    ? [userQuery.data.firstName, userQuery.data.lastName].filter(Boolean).join(" ") || userQuery.data.email
    : undefined;
  useBreadcrumbLabel(displayName);

  if (userQuery.isLoading) {
    return <LoadingState label="Loading user…" />;
  }

  if (userQuery.isError) {
    // A 404 (ResourceNotFoundException) and a 403 (PermissionsGuard) both
    // land here — the message the backend already gave is specific and
    // safe to show as-is (see AllExceptionsFilter).
    return <ErrorState title="Unable to load this user" description={getApiErrorMessage(userQuery.error)} onRetry={() => userQuery.refetch()} />;
  }

  const user = userQuery.data!;
  const statusMeta = getUserStatusMeta(user.status);

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${displayName}?`,
      description: "This removes the user record. This action cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(user.id);
      notify({ message: `${displayName} was deleted.`, severity: "success" });
      navigate("/users");
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleRevokeRole = async (grantId: string, roleName: string) => {
    const confirmed = await confirm({
      title: `Revoke ${roleName}?`,
      description: `${displayName} will immediately lose every permission this role granted, unless another grant covers the same permission.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokeRoleMutation.mutateAsync(grantId);
      notify({ message: `${roleName} was revoked.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <PageHeader
        title={displayName!}
        description={user.email}
        status={<StatusBadge status={statusMeta.statusKey} label={statusMeta.label} />}
        onBack={() => navigate("/users")}
        actions={
          <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
            <Tooltip title="Delete user">
              <IconButton color="error" onClick={handleDelete} aria-label="Delete user" disabled={deleteMutation.isPending}>
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </PermissionGate>
        }
      />

      <Tabs value={tab} onChange={(_event: SyntheticEvent, value: number) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Overview" />
        <Tab label="Roles" />
        <Tab label="Memberships" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Grid container spacing={2}>
                <Field label="Email" value={user.email} />
                <Field label="Username" value={user.username || "—"} />
                <Field label="First name" value={user.firstName || "—"} />
                <Field label="Last name" value={user.lastName || "—"} />
                <Field label="Email verified" value={formatDate(user.emailVerifiedAt)} />
                <Field label="Last login" value={formatDate(user.lastLoginAt)} />
                <Field label="Created" value={formatDate(user.createdAt)} />
              </Grid>
            </CardContent>
          </Card>

          <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
            <Card>
              <CardContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Lifecycle
                </Typography>
                <UserLifecycleActions user={user} />
              </CardContent>
            </Card>
          </PermissionGate>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
            <Box>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAssignRoleOpen(true)}>
                Assign role
              </Button>
            </Box>
          </PermissionGate>

          <Card>
            {rolesQuery.isLoading ? (
              <CardContent>
                <LoadingState dense />
              </CardContent>
            ) : rolesQuery.isError ? (
              <CardContent>
                <ErrorState dense description={getApiErrorMessage(rolesQuery.error)} onRetry={() => rolesQuery.refetch()} />
              </CardContent>
            ) : rolesQuery.data && rolesQuery.data.length > 0 ? (
              <List disablePadding>
                {rolesQuery.data.map((grant) => (
                  <ListItem
                    key={grant.id}
                    secondaryAction={
                      <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleRevokeRole(grant.id, grant.role.roleName)}
                          disabled={revokeRoleMutation.isPending}
                        >
                          Revoke
                        </Button>
                      </PermissionGate>
                    }
                  >
                    <ListItemText
                      primary={grant.role.roleName}
                      secondary={grant.organizationId ? "Organization-scoped" : "Tenant-wide"}
                    />
                    <Chip label={grant.role.roleCode} size="small" variant="outlined" sx={{ mr: 2 }} />
                  </ListItem>
                ))}
              </List>
            ) : (
              <CardContent>
                <EmptyState variant="no-data" title="No role grants" description="This user has no roles assigned yet." dense />
              </CardContent>
            )}
          </Card>
        </Stack>
      )}

      {tab === 2 && (
        <Card>
          {membershipsQuery.isLoading ? (
            <CardContent>
              <LoadingState dense />
            </CardContent>
          ) : membershipsQuery.isError ? (
            <CardContent>
              <ErrorState dense description={getApiErrorMessage(membershipsQuery.error)} onRetry={() => membershipsQuery.refetch()} />
            </CardContent>
          ) : !membershipsQuery.data || membershipsQuery.data.items.length === 0 ? (
            <CardContent>
              <EmptyState variant="no-data" title="No memberships" description="This user has no organization membership in this tenant." dense />
            </CardContent>
          ) : (
            <List disablePadding>
              {membershipsQuery.data.items.map((membership) => {
                const meta = getMembershipStatusMeta(membership.status);
                return (
                  <ListItem
                    key={membership.id}
                    secondaryAction={
                      <Button size="small" onClick={() => navigate(`/organizations/${membership.organization.id}`)}>
                        View organization
                      </Button>
                    }
                  >
                    <ListItemText primary={membership.organization.organizationName} secondary={`Member since ${formatDate(membership.createdAt)}`} />
                    <Box sx={{ mr: 2 }}>
                      <StatusBadge status={meta.statusKey} label={meta.label} />
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Card>
      )}

      {id && <AssignRoleDialog open={assignRoleOpen} userId={id} onClose={() => setAssignRoleOpen(false)} />}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Grid>
  );
}
