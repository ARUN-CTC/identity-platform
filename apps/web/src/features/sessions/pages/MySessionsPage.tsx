import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { getApiErrorMessage, type Session } from "@/shared/api";

import { useMySessionsQuery, useRevokeOtherSessionsMutation, useRevokeSessionMutation } from "../hooks";

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/**
 * Self-service only — there is no admin view of another user's sessions
 * today (see shared/api/sessions.ts's own doc comment). Every authenticated
 * user reaches this, regardless of permissions, same as TravelOS's own
 * `/iam/security` — it is about the caller's own account, not an
 * administration surface.
 */
export default function MySessionsPage() {
  const { sessionId: currentSessionId, signOut } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const sessionsQuery = useMySessionsQuery();
  const revokeMutation = useRevokeSessionMutation();
  const revokeOthersMutation = useRevokeOtherSessionsMutation();

  const handleRevoke = async (session: Session) => {
    const isCurrent = session.id === currentSessionId;
    const confirmed = await confirm({
      title: isCurrent ? "Sign out of this device?" : "Sign out of this session?",
      description: isCurrent
        ? "This is the device you're using right now — you'll be signed out immediately."
        : `This immediately ends that session on ${session.deviceInfo ?? "that device"}.`,
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await revokeMutation.mutateAsync(session.id);
      if (isCurrent) {
        // The very next authenticated request from this device would 401
        // anyway (JwtAuthGuard checks session liveness on every request) —
        // clear local state and leave now rather than let that surface as
        // a confusing mid-action session-expired notice.
        navigate("/login", { replace: true });
        void signOut();
        return;
      }
      notify({ message: "Session signed out.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleRevokeOthers = async () => {
    const confirmed = await confirm({
      title: "Sign out of all other devices?",
      description: "Every other active session is ended immediately. This device stays signed in.",
      confirmLabel: "Sign out others",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokeOthersMutation.mutateAsync();
      notify({ message: "Signed out of every other device.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const otherActiveSessionCount = (sessionsQuery.data ?? []).filter((s) => !s.revokedAt && s.id !== currentSessionId).length;

  return (
    <>
      <PageHeader
        title="My sessions"
        description="Devices and browsers currently or previously signed in as you."
        actions={
          <Button
            variant="outlined"
            color="error"
            onClick={handleRevokeOthers}
            disabled={otherActiveSessionCount === 0 || revokeOthersMutation.isPending}
            loading={revokeOthersMutation.isPending}
          >
            Sign out of all other devices
          </Button>
        }
      />

      <Card>
        {sessionsQuery.isLoading ? (
          <CardContent>
            <LoadingState dense />
          </CardContent>
        ) : sessionsQuery.isError ? (
          <CardContent>
            <ErrorState description={getApiErrorMessage(sessionsQuery.error)} onRetry={() => sessionsQuery.refetch()} />
          </CardContent>
        ) : !sessionsQuery.data || sessionsQuery.data.length === 0 ? (
          <CardContent>
            <EmptyState variant="no-data" title="No sessions found" />
          </CardContent>
        ) : (
          <List disablePadding>
            {sessionsQuery.data.map((session) => {
              const isCurrent = session.id === currentSessionId;
              const isRevoked = !!session.revokedAt;
              const isExpired = new Date(session.expiresAt) < new Date();
              return (
                <ListItem
                  key={session.id}
                  divider
                  secondaryAction={
                    !isRevoked && (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => handleRevoke(session)}
                        disabled={revokeMutation.isPending}
                      >
                        Sign out
                      </Button>
                    )
                  }
                >
                  <ListItemIcon>
                    <ComputerOutlinedIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {session.deviceInfo ?? "Unknown device"}
                        </Typography>
                        {isCurrent && <Chip label="This device" size="small" color="primary" variant="outlined" />}
                        {isRevoked && <Chip label={`Signed out${session.revokedReason ? ` — ${session.revokedReason}` : ""}`} size="small" />}
                        {!isRevoked && isExpired && <Chip label="Expired" size="small" />}
                      </Stack>
                    }
                    secondary={`${session.ipAddress ?? "Unknown IP"} · Created ${formatDate(session.createdAt)} · Last used ${formatDate(session.lastUsedAt)}`}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </Card>
    </>
  );
}
