import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState, type SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useBreadcrumbLabel } from "@/app/router/BreadcrumbLabel";
import { useNotify } from "@/app/providers/NotificationProvider";
import { DataTable, type GridColDef } from "@/design-system/components/DataTable";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { usePermissions } from "@/shared/hooks";
import { getApiErrorMessage, listMembers, type Member } from "@/shared/api";

import { CreateUserDrawer } from "@/features/users/CreateUserDrawer";

import { MembershipStatusMenu } from "../MembershipStatusMenu";
import { OrganizationFormDrawer } from "../OrganizationFormDrawer";
import { ResendInvitationButton } from "../ResendInvitationButton";
import { getMembershipStatusMeta, getOrganizationStatusMeta } from "../statusMeta";
import { useDeleteOrganizationMutation, useMembersQuery, useOrganizationQuery } from "../hooks";

function memberDisplayName(member: Member): string {
  return [member.user.firstName, member.user.lastName].filter(Boolean).join(" ") || member.user.email;
}

export default function OrganizationDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const [tab, setTab] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [membersPage, setMembersPage] = useState({ page: 0, pageSize: 25 });

  const organizationQuery = useOrganizationQuery(id);
  const canViewMembers = usePermissions([PERMISSIONS.USER_MANAGE, PERMISSIONS.USER_VIEW]);
  const membersParams = { page: membersPage.page + 1, limit: membersPage.pageSize };
  const membersQuery = useMembersQuery(canViewMembers && tab === 1 ? id : undefined, membersParams);
  const deleteMutation = useDeleteOrganizationMutation();

  useBreadcrumbLabel(organizationQuery.data?.organizationName);

  if (organizationQuery.isLoading) {
    return <LoadingState label="Loading organization…" />;
  }

  if (organizationQuery.isError) {
    // A 404 (cross-tenant or nonexistent — organization has RLS scoped to
    // the caller's own tenant, so both look identical here by design) and
    // a 403 both land here with the backend's own safe message.
    return (
      <ErrorState
        title="Unable to load this organization"
        description={getApiErrorMessage(organizationQuery.error)}
        onRetry={() => organizationQuery.refetch()}
      />
    );
  }

  const organization = organizationQuery.data!;
  const statusMeta = getOrganizationStatusMeta(organization.status);

  const handleDelete = async () => {
    // The backend does not block deleting an organization that still has
    // members (see shared/api/organizations.ts's own doc comment) — this
    // count is surfaced so the admin isn't surprised, not to gate the
    // action, which the backend genuinely allows either way.
    let memberCount = 0;
    try {
      const result = await listMembers(organization.id, { page: 1, limit: 1 });
      memberCount = result.meta.total;
    } catch {
      // Best-effort context for the confirmation copy only — a failure to
      // count members must never block the delete action itself.
    }

    const confirmed = await confirm({
      title: `Delete ${organization.organizationName}?`,
      description:
        memberCount > 0
          ? `This organization still has ${memberCount} member${memberCount === 1 ? "" : "s"}. Deleting it does not remove their accounts, but their membership here becomes orphaned. This action cannot be undone.`
          : "This action cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(organization.id);
      notify({ message: `${organization.organizationName} was deleted.`, severity: "success" });
      navigate("/organizations");
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const memberColumns: GridColDef<Member>[] = [
    { field: "name", headerName: "User", flex: 1, minWidth: 200, valueGetter: (_value, row) => memberDisplayName(row) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.user.email },
    {
      field: "status",
      headerName: "Membership status",
      width: 170,
      renderCell: (params) => {
        const meta = getMembershipStatusMeta(params.row.status);
        return <StatusBadge status={meta.statusKey} label={meta.label} />;
      },
    },
    {
      field: "actions",
      headerName: "",
      flex: 1,
      minWidth: 260,
      sortable: false,
      renderCell: (params) => (
        <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
          <Stack direction="row" spacing={1}>
            {params.row.status === "INVITED" && (
              <ResendInvitationButton organizationId={organization.id} userId={params.row.userId} email={params.row.user.email} />
            )}
            <MembershipStatusMenu organizationId={organization.id} member={params.row} />
          </Stack>
        </PermissionGate>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={organization.organizationName}
        description={organization.organizationCode}
        status={<StatusBadge status={statusMeta.statusKey} label={statusMeta.label} />}
        onBack={() => navigate("/organizations")}
        actions={
          <>
            <Tooltip title="Edit organization">
              <IconButton onClick={() => setEditOpen(true)} aria-label="Edit organization">
                <EditOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete organization">
              <IconButton color="error" onClick={handleDelete} aria-label="Delete organization" disabled={deleteMutation.isPending}>
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      <Tabs value={tab} onChange={(_event: SyntheticEvent, value: number) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Overview" />
        <Tab label="Members" />
      </Tabs>

      {tab === 0 && (
        <Card>
          <CardContent>
            <Grid container spacing={2}>
              <Field label="Organization code" value={organization.organizationCode} />
              <Field label="Organization name" value={organization.organizationName} />
              <Field label="Legal name" value={organization.legalName || "—"} />
              <Field label="Email" value={organization.email || "—"} />
              <Field label="Phone" value={organization.phone || "—"} />
              <Field label="Website" value={organization.website || "—"} />
            </Grid>
          </CardContent>
        </Card>
      )}

      {tab === 1 &&
        (!canViewMembers ? (
          <ErrorState title="You don't have permission to view members" description="Viewing members requires the Users permission." />
        ) : (
          <Stack spacing={2}>
            <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
              <Box>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddMemberOpen(true)}>
                  Add member
                </Button>
              </Box>
            </PermissionGate>

            <DataTable<Member>
              columns={memberColumns}
              rows={membersQuery.data?.items ?? []}
              getRowId={(row) => row.id}
              loading={membersQuery.isLoading}
              error={membersQuery.isError ? membersQuery.error : undefined}
              errorMessage={membersQuery.isError ? getApiErrorMessage(membersQuery.error) : undefined}
              onRetry={() => membersQuery.refetch()}
              paginationMode="server"
              rowCount={membersQuery.data?.meta.total ?? 0}
              paginationModel={membersPage}
              onPaginationModelChange={setMembersPage}
              emptyState={{ variant: "no-data", title: "No members", description: "Add a member to get started." }}
            />
          </Stack>
        ))}

      <OrganizationFormDrawer open={editOpen} onClose={() => setEditOpen(false)} organization={organization} />
      {id && (
        <CreateUserDrawer
          open={addMemberOpen}
          onClose={() => setAddMemberOpen(false)}
          fixedOrganizationId={id}
          fixedOrganizationName={organization.organizationName}
          navigateToNewUser={false}
          onCreated={() => membersQuery.refetch()}
        />
      )}
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
