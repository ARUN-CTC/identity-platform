import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import LockPersonOutlinedIcon from "@mui/icons-material/LockPersonOutlined";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import Avatar from "@mui/material/Avatar";
import Stack from "@mui/material/Stack";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import type { ComponentType } from "react";

import { EmptyState } from "@/design-system/components/EmptyState";
import { formatDateTime, formatRelativeTime } from "@/shared/utils/formatters";

export type AuditEventType =
  | "created"
  | "updated"
  | "activated"
  | "deactivated"
  | "approved"
  | "rejected"
  | "deleted"
  | "permission_changed"
  | "configuration_changed"
  | "security_event";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  /** e.g. "Priya Sharma updated the billing address" — actor + description pre-composed by the caller. */
  description: string;
  actorName?: string;
  occurredAt: string | Date;
}

const EVENT_ICON: Record<AuditEventType, ComponentType<SvgIconProps>> = {
  created: AddCircleOutlineIcon,
  updated: EditOutlinedIcon,
  activated: CheckCircleOutlineIcon,
  deactivated: PauseCircleOutlinedIcon,
  approved: CheckCircleOutlineIcon,
  rejected: HighlightOffIcon,
  deleted: DeleteOutlineIcon,
  permission_changed: LockPersonOutlinedIcon,
  configuration_changed: TuneOutlinedIcon,
  security_event: SecurityOutlinedIcon,
};

const EVENT_COLOR: Record<AuditEventType, "success" | "error" | "warning" | "info" | "default"> = {
  created: "success",
  updated: "info",
  activated: "success",
  deactivated: "warning",
  approved: "success",
  rejected: "error",
  deleted: "error",
  permission_changed: "warning",
  configuration_changed: "info",
  security_event: "warning",
};

export interface ActivityTimelineProps {
  events: AuditEvent[];
}

/** Chronological audit/activity feed used on every domain's details page "Audit" tab. */
export function ActivityTimeline({ events }: ActivityTimelineProps) {
  if (events.length === 0) {
    return <EmptyState variant="no-data" title="No activity yet" description="Actions on this record will appear here." dense />;
  }

  return (
    <Stack spacing={0}>
      {events.map((event, index) => {
        const Icon = EVENT_ICON[event.type];
        const isLast = index === events.length - 1;

        return (
          <Stack key={event.id} direction="row" spacing={2}>
            <Stack alignItems="center" sx={{ flexShrink: 0 }}>
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: `${EVENT_COLOR[event.type]}.light`,
                  color: `${EVENT_COLOR[event.type]}.dark`,
                }}
              >
                <Icon fontSize="small" />
              </Avatar>
              {!isLast && <Stack sx={{ flex: 1, width: "2px", bgcolor: "divider", my: 0.5 }} />}
            </Stack>
            <Stack sx={{ pb: isLast ? 0 : 3 }}>
              <Typography variant="body2">{event.description}</Typography>
              <Typography variant="caption" color="text.secondary" title={formatDateTime(event.occurredAt)}>
                {event.actorName ? `${event.actorName} · ` : ""}
                {formatRelativeTime(event.occurredAt)}
              </Typography>
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}
