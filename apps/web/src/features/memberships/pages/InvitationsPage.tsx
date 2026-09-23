import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterSelect } from "@/design-system/components/FilterSelect";
import { PageHeader } from "@/design-system/components/PageHeader";
import { CreateUserDrawer } from "@/features/users/CreateUserDrawer";
import { ResendInvitationButton } from "@/features/organizations/ResendInvitationButton";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage, type TenantMember } from "@/shared/api";

import { useOrganizationsLookupQuery, useTenantMembershipsQuery } from "../hooks";

function displayName(member: TenantMember): string {
  return [member.user.firstName, member.user.lastName].filter(Boolean).join(" ") || member.user.email;
}

/**
 * Every membership currently sitting at INVITED, across the whole tenant —
 * the real, honest shape of "pending invitations" this backend supports
 * (GET /memberships?status=INVITED; see docs/PHASE_2UI4.md's API gap table).
 * "Invite user" reuses CreateUserDrawer unchanged: it already IS the real
 * invite flow (email → name → organization → send), not a separate
 * capability that needs its own parallel form. There is no
 * revoke-invitation endpoint on this backend — that action is intentionally
 * not offered here rather than shown disabled (see docs/PHASE_2UI4.md).
 */
export default function InvitationsPage() {
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [inviteOpen, setInviteOpen] = useState(false);

  const queryParams = useMemo(
    () => ({
      page: paginationModel.page + 1,
      limit: paginationModel.pageSize,
      organizationId: organizationId || undefined,
      status: "INVITED" as const,
    }),
    [paginationModel, organizationId],
  );

  const invitationsQuery = useTenantMembershipsQuery(queryParams);
  const organizationsQuery = useOrganizationsLookupQuery(true);
  const organizationOptions = (organizationsQuery.data?.items ?? []).map((org) => ({ value: org.id, label: org.organizationName }));

  const columns: GridColDef<TenantMember>[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => displayName(row) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.user.email },
    {
      field: "organization",
      headerName: "Organization",
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row) => row.organization.organizationName,
    },
    {
      field: "createdAt",
      headerName: "Invited",
      width: 160,
      valueGetter: (value) => new Date(value as string).toLocaleDateString(),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 180,
      sortable: false,
      renderCell: (params) => (
        <ResendInvitationButton organizationId={params.row.organization.id} userId={params.row.userId} email={params.row.user.email} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invitations"
        description="Everyone invited into this tenant who hasn't accepted yet."
        actions={
          <PermissionGate permission={PERMISSIONS.USER_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setInviteOpen(true)}>
              Invite user
            </Button>
          </PermissionGate>
        }
      />

      <DataTable<TenantMember>
        columns={columns}
        rows={invitationsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={invitationsQuery.isLoading}
        error={invitationsQuery.isError ? invitationsQuery.error : undefined}
        errorMessage={invitationsQuery.isError ? getApiErrorMessage(invitationsQuery.error) : undefined}
        onRetry={() => invitationsQuery.refetch()}
        paginationMode="server"
        rowCount={invitationsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: organizationId ? "no-results" : "no-data",
          title: organizationId ? "No pending invitations in this organization" : "No pending invitations",
          description: organizationId ? "Try a different organization." : "Invite someone to get started.",
        }}
        toolbar={
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <FilterSelect value={organizationId} onChange={setOrganizationId} options={organizationOptions} allLabel="All organizations" label="Organization" />
            {organizationId && (
              <Button size="small" onClick={() => setOrganizationId("")}>
                Clear filters
              </Button>
            )}
          </Stack>
        }
      />

      <CreateUserDrawer
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        navigateToNewUser={false}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["memberships"] })}
      />
    </>
  );
}
