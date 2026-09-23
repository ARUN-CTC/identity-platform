import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterSelect } from "@/design-system/components/FilterSelect";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getMembershipStatusMeta } from "@/features/organizations/statusMeta";
import { getApiErrorMessage, type MembershipStatus, type TenantMember } from "@/shared/api";

import { useOrganizationsLookupQuery, useTenantMembershipsQuery } from "../hooks";
import { TenantMembershipStatusMenu } from "../TenantMembershipStatusMenu";

const STATUS_OPTIONS: { value: MembershipStatus; label: string }[] = [
  { value: "INVITED", label: "Invited" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "REMOVED", label: "Removed" },
];

function displayName(member: TenantMember): string {
  return [member.user.firstName, member.user.lastName].filter(Boolean).join(" ") || member.user.email;
}

/**
 * Tenant-wide — spans every organization in the tenant (GET /memberships,
 * Phase 2UI.4). The per-organization equivalent (Organization Detail's own
 * Members tab) still exists unchanged for when the organization is already
 * the starting point; this page is for "who belongs to this tenant at all,
 * regardless of which organization."
 */
export default function MembershipsPage() {
  const navigate = useNavigate();
  const [organizationId, setOrganizationId] = useState("");
  const [status, setStatus] = useState<MembershipStatus | "">("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const queryParams = useMemo(
    () => ({
      page: paginationModel.page + 1,
      limit: paginationModel.pageSize,
      organizationId: organizationId || undefined,
      status: status || undefined,
    }),
    [paginationModel, organizationId, status],
  );

  const membershipsQuery = useTenantMembershipsQuery(queryParams);
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
      field: "status",
      headerName: "Membership status",
      width: 160,
      renderCell: (params) => {
        const meta = getMembershipStatusMeta(params.row.status);
        return <StatusBadge status={meta.statusKey} label={meta.label} />;
      },
    },
    {
      field: "createdAt",
      headerName: "Created",
      width: 160,
      valueGetter: (value) => new Date(value as string).toLocaleDateString(),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      // DataGrid's onRowClick fires on any click inside the row unless
      // stopped here — without this, clicking "Change status" also
      // navigates to the user (see onRowClick below).
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <TenantMembershipStatusMenu member={params.row} />
        </Box>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Memberships"
        description="Every membership across every organization in this tenant. A membership is what makes a global Identity belong here — see a user's own record for their identity details."
      />

      <DataTable<TenantMember>
        columns={columns}
        rows={membershipsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={membershipsQuery.isLoading}
        error={membershipsQuery.isError ? membershipsQuery.error : undefined}
        errorMessage={membershipsQuery.isError ? getApiErrorMessage(membershipsQuery.error) : undefined}
        onRetry={() => membershipsQuery.refetch()}
        onRowClick={(row) => navigate(`/users/${row.userId}`)}
        paginationMode="server"
        rowCount={membershipsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: organizationId || status ? "no-results" : "no-data",
          title: organizationId || status ? "No memberships match your filters" : "No memberships yet",
          description:
            organizationId || status ? "Try a different organization or status." : "Invite someone or add an existing user to an organization to get started.",
        }}
        toolbar={
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <FilterSelect
              value={organizationId}
              onChange={(value) => setOrganizationId(value)}
              options={organizationOptions}
              allLabel="All organizations"
              label="Organization"
            />
            <FilterSelect
              value={status}
              onChange={(value) => setStatus(value as MembershipStatus | "")}
              options={STATUS_OPTIONS}
              allLabel="All statuses"
              label="Status"
            />
            {(organizationId || status) && (
              <Button
                size="small"
                onClick={() => {
                  setOrganizationId("");
                  setStatus("");
                }}
              >
                Clear filters
              </Button>
            )}
          </Stack>
        }
      />
    </>
  );
}
