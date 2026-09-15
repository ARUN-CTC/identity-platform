import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { useNotify } from "@/app/providers/NotificationProvider";
import { Modal } from "@/design-system/components/Modal";
import type { SecurityEvent } from "@/shared/api";

import { getEventTypeLabel, renderSafeMetadata } from "./eventTypeMeta";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const notify = useNotify();
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify({ message: `${label} copied.`, severity: "success", autoHideDuration: 2000 });
    } catch {
      // Clipboard access can be denied/unavailable in some browser
      // contexts — the value is still shown in full text, just not
      // one-click-copyable there.
      notify({ message: "Couldn't copy — clipboard access is unavailable here.", severity: "warning" });
    }
  };

  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="body2" sx={{ wordBreak: "break-all", fontFamily: "monospace" }}>
          {value}
        </Typography>
        <Tooltip title={`Copy ${label.toLowerCase()}`}>
          <IconButton size="small" onClick={handleCopy} aria-label={`Copy ${label.toLowerCase()}`}>
            <ContentCopyOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

export interface EventDetailModalProps {
  event: SecurityEvent | null;
  onClose: () => void;
}

/**
 * There is no `GET /security-audit/events/:id` endpoint — the backend
 * exposes list-only routes (see shared/api/security-audit.ts's own doc
 * comment). Every field this modal shows is already present on the row
 * the list already fetched; this is a client-side expansion of that same
 * data, never a fresh request.
 */
export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const metadataEntries = renderSafeMetadata(event?.metadata);

  return (
    <Modal open={!!event} title={event ? getEventTypeLabel(event.eventType) : ""} onClose={onClose} maxWidth="sm">
      {event && (
        <Stack spacing={2}>
          <Field label="Timestamp" value={new Date(event.createdAt).toLocaleString()} />
          <Field label="Event type" value={event.eventType} />
          <Field label="Actor" value={event.actorUserId ?? "System"} />
          {event.resourceType && <Field label="Resource" value={`${event.resourceType}${event.resourceId ? ` · ${event.resourceId}` : ""}`} />}
          {event.ipAddress && <Field label="IP address" value={event.ipAddress} />}
          {event.correlationId && <CopyableField label="Correlation ID" value={event.correlationId} />}
          {metadataEntries.length > 0 && (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Details
              </Typography>
              <Stack spacing={0.5} sx={{ pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
                {metadataEntries.map((entry) => (
                  <Typography key={entry.key} variant="body2">
                    <strong>{entry.key}:</strong> {entry.value}
                  </Typography>
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}
