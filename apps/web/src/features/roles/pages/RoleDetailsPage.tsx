import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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
import { useMemo, useState, type SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useBreadcrumbLabel } from "@/app/router/BreadcrumbLabel";
import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage } from "@/shared/api";

import { GrantPermissionDialog } from "../GrantPermissionDialog";
import { RoleFormDrawer } from "../RoleFormDrawer";
import { useDeleteRoleMutation, usePermissionsLookupQuery, useRevokePermissionMutation, useRoleQuery, useRolePermissionsQuery } from "../hooks";

export default function RoleDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const [tab, setTab] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  const roleQuery = useRoleQuery(id);
  const grantsQuery = useRolePermissionsQuery(id);
  const permissionsLookup = usePermissionsLookupQuery();
  const deleteMutation = useDeleteRoleMutation();
  const revokeMutation = useRevokePermissionMutation(id ?? "");

  useBreadcrumbLabel(roleQuery.data?.roleName);

  const permissionById = useMemo(() => {
    const map = new Map((permissionsLookup.data?.items ?? []).map((p) => [p.id, p] as const));
    return map;
  }, [permissionsLookup.data]);

  if (roleQuery.isLoading) {
    return <LoadingState label="Loading role…" />;
  }

  if (roleQuery.isError) {
    // security_role is RLS-scoped to (this tenant OR system) — a role from
    // another tenant looks identical to a nonexistent one: a plain 404.
    return (
      <ErrorState title="Unable to load this role" description={getApiErrorMessage(roleQuery.error)} onRetry={() => roleQuery.refetch()} />
    );
  }

  const role = roleQuery.data!;

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${role.roleName}?`,
      description: "This action cannot be undone. If any user still holds this role, the backend will refuse to delete it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(role.id);
      notify({ message: `${role.roleName} was deleted.`, severity: "success" });
      navigate("/roles");
    } catch (error) {
      // A 409 here (still assigned to users) is real and expected —
      // surfaced exactly as the backend phrased it, not retried.
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleRevoke = async (permissionId: string, permissionCode: string) => {
    const confirmed = await confirm({
      title: `Revoke ${permissionCode}?`,
      description: `Every user holding ${role.roleName} loses this permission immediately, unless another grant still covers it.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokeMutation.mutateAsync(permissionId);
      notify({ message: `${permissionCode} was revoked.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <PageHeader
        title={role.roleName}
        description={role.roleCode}
        status={role.isSystem ? <Chip label="System role" size="small" variant="outlined" /> : <Chip label="Custom role" size="small" color="primary" variant="outlined" />}
        onBack={() => navigate("/roles")}
        actions={
          // System roles (SUPER_ADMIN/TENANT_ADMIN/MEMBER) are seed-managed
          // only — the backend rejects any edit/delete with 400
          // SYSTEM_ROLE_IMMUTABLE regardless, so these actions are not
          // offered at all rather than shown and then failing.
          !role.isSystem && (
            <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
              <Tooltip title="Edit role">
                <IconButton onClick={() => setEditOpen(true)} aria-label="Edit role">
                  <EditOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete role">
                <IconButton color="error" onClick={handleDelete} aria-label="Delete role" disabled={deleteMutation.isPending}>
                  <DeleteOutlineIcon />
                </IconButton>
              </Tooltip>
            </PermissionGate>
          )
        }
      />

      <Tabs value={tab} onChange={(_event: SyntheticEvent, value: number) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Overview" />
        <Tab label="Permissions" />
      </Tabs>

      {tab === 0 && (
        <Card>
          <CardContent>
            <Grid container spacing={2}>
              <Field label="Role code" value={role.roleCode} />
              <Field label="Role name" value={role.roleName} />
              <Field label="Description" value={role.description || "—"} />
            </Grid>
          </CardContent>
        </Card>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
            <Box>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setGrantOpen(true)}>
                Grant permission
              </Button>
            </Box>
          </PermissionGate>

          <Card>
            {grantsQuery.isLoading ? (
              <CardContent>
                <LoadingState dense />
              </CardContent>
            ) : grantsQuery.isError ? (
              <CardContent>
                <ErrorState dense description={getApiErrorMessage(grantsQuery.error)} onRetry={() => grantsQuery.refetch()} />
              </CardContent>
            ) : grantsQuery.data && grantsQuery.data.length > 0 ? (
              <List disablePadding>
                {grantsQuery.data.map((grant) => {
                  const permission = permissionById.get(grant.permissionId);
                  return (
                    <ListItem
                      key={grant.id}
                      secondaryAction={
                        <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleRevoke(grant.permissionId, permission?.permissionCode ?? grant.permissionId)}
                            disabled={revokeMutation.isPending}
                          >
                            Revoke
                          </Button>
                        </PermissionGate>
                      }
                    >
                      <ListItemText
                        primary={permission?.permissionCode ?? grant.permissionId}
                        secondary={permission ? `${permission.resource} · ${permission.action}` : undefined}
                      />
                      {permission?.platformOnly && <Chip label="Platform-only" size="small" sx={{ mr: 2 }} />}
                    </ListItem>
                  );
                })}
              </List>
            ) : (
              <CardContent>
                <EmptyState variant="no-data" title="No permissions granted" description="Grant a permission to get started." dense />
              </CardContent>
            )}
          </Card>
        </Stack>
      )}

      <RoleFormDrawer open={editOpen} onClose={() => setEditOpen(false)} role={role} />
      {id && <GrantPermissionDialog open={grantOpen} onClose={() => setGrantOpen(false)} roleId={id} currentGrants={grantsQuery.data ?? []} />}
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
