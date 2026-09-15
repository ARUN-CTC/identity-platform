import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useState, type SyntheticEvent } from "react";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterBar } from "@/design-system/components/FilterBar";
import { FilterSelect } from "@/design-system/components/FilterSelect";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { useDebounce } from "@/shared/hooks";
import { getApiErrorMessage, type LoginAttempt, type SecurityEvent } from "@/shared/api";

import { EventDetailModal } from "../EventDetailModal";
import { getEventTypeLabel, KNOWN_TENANT_EVENT_TYPES } from "../eventTypeMeta";
import { useLoginAttemptsQuery, useSecurityEventsQuery } from "../hooks";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function EventsTab() {
  const [eventType, setEventType] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);

  // Backend pagination is 1-indexed; MUI DataGrid's is 0-indexed. eventType
  // is an exact match, not a search (see security-event-query.dto.ts) — the
  // filter is a picker of known real values, not free text. There is no
  // date-range or correlationId filter param at all; none is offered here.
  const queryParams = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    eventType: eventType || undefined,
    actorUserId: actorUserId.trim() || undefined,
  };
  const eventsQuery = useSecurityEventsQuery(queryParams);

  const columns: GridColDef<SecurityEvent>[] = [
    { field: "createdAt", headerName: "Time", width: 190, valueGetter: (value) => formatDate(value as string) },
    { field: "eventType", headerName: "Event", flex: 1, minWidth: 220, valueGetter: (value) => getEventTypeLabel(value as string) },
    { field: "actorUserId", headerName: "Actor", width: 220, valueGetter: (value) => value || "System" },
    { field: "resourceType", headerName: "Resource", width: 160, valueGetter: (value) => value || "—" },
  ];

  return (
    <>
      <DataTable<SecurityEvent>
        columns={columns}
        rows={eventsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={eventsQuery.isLoading}
        error={eventsQuery.isError ? eventsQuery.error : undefined}
        errorMessage={eventsQuery.isError ? getApiErrorMessage(eventsQuery.error) : undefined}
        onRetry={() => eventsQuery.refetch()}
        onRowClick={(row) => setSelectedEvent(row)}
        paginationMode="server"
        rowCount={eventsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: eventType || actorUserId ? "no-results" : "no-data",
          title: eventType || actorUserId ? "No events match your filters" : "No security events found",
        }}
        toolbar={
          <FilterBar
            searchValue={actorUserId}
            onSearchChange={setActorUserId}
            searchPlaceholder="Filter by exact actor user ID…"
            activeFilterCount={eventType ? 1 : 0}
            onClearFilters={() => setEventType("")}
            filters={<FilterSelect value={eventType} onChange={setEventType} options={KNOWN_TENANT_EVENT_TYPES} allLabel="All event types" label="Event type" minWidth={240} />}
          />
        }
      />
      <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </>
  );
}

const OUTCOME_OPTIONS = [
  { value: "true", label: "Success" },
  { value: "false", label: "Failed" },
];

function LoginAttemptsTab() {
  const [identifierInput, setIdentifierInput] = useState("");
  const identifier = useDebounce(identifierInput, 300);
  const [success, setSuccess] = useState("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });

  const queryParams = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    identifier: identifier || undefined,
    success: success ? (success as "true" | "false") : undefined,
  };
  const attemptsQuery = useLoginAttemptsQuery(queryParams);

  const columns: GridColDef<LoginAttempt>[] = [
    { field: "createdAt", headerName: "Time", width: 190, valueGetter: (value) => formatDate(value as string) },
    { field: "identifier", headerName: "Identifier", flex: 1, minWidth: 220 },
    {
      field: "success",
      headerName: "Result",
      width: 130,
      renderCell: (params) =>
        params.row.success ? <StatusBadge status="active" label="Success" /> : <StatusBadge status="rejected" label="Failed" />,
    },
    { field: "failureReason", headerName: "Reason", flex: 1, minWidth: 180, valueGetter: (value) => value || "—" },
    { field: "ipAddress", headerName: "IP address", width: 150, valueGetter: (value) => value || "—" },
  ];

  return (
    <DataTable<LoginAttempt>
      columns={columns}
      rows={attemptsQuery.data?.items ?? []}
      getRowId={(row) => row.id}
      loading={attemptsQuery.isLoading}
      error={attemptsQuery.isError ? attemptsQuery.error : undefined}
      errorMessage={attemptsQuery.isError ? getApiErrorMessage(attemptsQuery.error) : undefined}
      onRetry={() => attemptsQuery.refetch()}
      paginationMode="server"
      rowCount={attemptsQuery.data?.meta.total ?? 0}
      paginationModel={paginationModel}
      onPaginationModelChange={setPaginationModel}
      emptyState={{
        variant: identifier || success ? "no-results" : "no-data",
        title: identifier || success ? "No login attempts match your filters" : "No login attempts found",
      }}
      toolbar={
        <FilterBar
          searchValue={identifierInput}
          onSearchChange={setIdentifierInput}
          searchPlaceholder="Search by email or tenant code…"
          activeFilterCount={success ? 1 : 0}
          onClearFilters={() => setSuccess("")}
          filters={<FilterSelect value={success} onChange={setSuccess} options={OUTCOME_OPTIONS} allLabel="All outcomes" label="Outcome" />}
        />
      }
    />
  );
}

/**
 * `GET /security-audit/events` and `.../login-attempts` are tenant-wide,
 * not organization-scoped — anyone holding SECURITY_AUDIT_VIEW sees every
 * event/attempt across the whole tenant regardless of their own active
 * organization context. This is the backend's real, intended behavior
 * (SecurityAuditRepository filters by tenantId only), not a gap this page
 * should second-guess with a client-side organization filter that doesn't
 * exist server-side.
 */
export default function SecurityAuditPage() {
  const [tab, setTab] = useState(0);

  return (
    <>
      <PageHeader title="Security & Audit" description="Security events and login attempts across this tenant." />
      <Tabs value={tab} onChange={(_event: SyntheticEvent, value: number) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Security Events" />
        <Tab label="Login Attempts" />
      </Tabs>
      {tab === 0 && <EventsTab />}
      {tab === 1 && <LoginAttemptsTab />}
      {tab === 0 && (
        <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
          Showing this tenant's events only. There is no date-range filter or free-text search across events today —
          only an exact event type and actor user ID.
        </Typography>
      )}
    </>
  );
}
