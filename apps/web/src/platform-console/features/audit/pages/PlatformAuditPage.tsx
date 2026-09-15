import TextField from "@mui/material/TextField";
import { useState } from "react";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage, type SecurityEvent } from "@/shared/api";
import { listPlatformAuditEvents, type PlatformSecurityEvent } from "@/shared/platform-api";
import { useQuery } from "@tanstack/react-query";

import { EventDetailModal } from "../../../../features/security-audit/EventDetailModal";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * `GET /platform/audit-events` — PLATFORM-scoped security_event rows only
 * (scope='PLATFORM', tenantId always null). Reuses the tenant Security &
 * Audit module's own EventDetailModal (identical row shape, identical
 * safe-metadata rendering) rather than duplicating it — see
 * shared/platform-api/audit.ts's own doc comment for why the two event
 * streams are never merged into one screen: mixing PLATFORM_* events (this
 * page) with a tenant's own TENANT-scoped events would violate the exact
 * boundary this whole phase exists to enforce.
 */
export default function PlatformAuditPage() {
  const [eventType, setEventType] = useState("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [selectedEvent, setSelectedEvent] = useState<PlatformSecurityEvent | null>(null);

  const query = useQuery({
    queryKey: ["platform", "audit-events", paginationModel, eventType],
    queryFn: () => listPlatformAuditEvents({ page: paginationModel.page + 1, limit: paginationModel.pageSize, eventType: eventType || undefined }),
  });

  const columns: GridColDef<PlatformSecurityEvent>[] = [
    { field: "createdAt", headerName: "Time", width: 190, valueGetter: (value) => formatDate(value as string) },
    { field: "eventType", headerName: "Event", flex: 1, minWidth: 240 },
    { field: "actorUserId", headerName: "Actor", width: 220, valueGetter: (value) => value || "System" },
    { field: "resourceType", headerName: "Resource", width: 160, valueGetter: (value) => value || "—" },
  ];

  return (
    <>
      <PageHeader title="Platform Audit" description="Platform-scoped security events — never a tenant's own activity, and never visible through any tenant's Security & Audit screen." />

      <DataTable<PlatformSecurityEvent>
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        errorMessage={query.isError ? getApiErrorMessage(query.error) : undefined}
        onRetry={() => query.refetch()}
        onRowClick={(row) => setSelectedEvent(row)}
        paginationMode="server"
        rowCount={query.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: eventType ? "no-results" : "no-data", title: eventType ? "No events match this filter" : "No platform events found" }}
        toolbar={<TextField size="small" label="Event type (exact match)" value={eventType} onChange={(e) => setEventType(e.target.value)} sx={{ minWidth: 260 }} />}
      />

      <EventDetailModal event={selectedEvent as unknown as SecurityEvent | null} onClose={() => setSelectedEvent(null)} />
    </>
  );
}
