import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { ApiError, getApiErrorMessage } from "@/shared/api";
import type { PlatformOperatorStatus } from "@/shared/platform-api";

import { PLATFORM_PERMISSIONS } from "../../../permissions";
import { usePlatformAuth } from "../../../providers/PlatformAuthProvider";
import {
  useGrantPlatformOperatorPermissionMutation,
  usePlatformOperatorQuery,
  useRevokePlatformOperatorPermissionMutation,
  useSetPlatformOperatorStatusMutation,
} from "../hooks";

const ALL_CODES = Object.values(PLATFORM_PERMISSIONS);

export default function PlatformOperatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const { operator: self } = usePlatformAuth();
  const [selectedCode, setSelectedCode] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);

  const operatorQuery = usePlatformOperatorQuery(id);
  const statusMutation = useSetPlatformOperatorStatusMutation(id ?? "");
  const grantMutation = useGrantPlatformOperatorPermissionMutation(id ?? "");
  const revokeMutation = useRevokePlatformOperatorPermissionMutation(id ?? "");

  if (operatorQuery.isLoading) return <LoadingState label="Loading operator…" />;
  if (operatorQuery.isError) {
    return <ErrorState title="Unable to load this operator" description={getApiErrorMessage(operatorQuery.error)} onRetry={() => operatorQuery.refetch()} />;
  }
  const operator = operatorQuery.data!;
  const isSelf = self?.id === operator.id;

  const handleStatusChange = async (status: PlatformOperatorStatus) => {
    if (status === "DISABLED") {
      const confirmed = await confirm({
        title: `Disable this operator?`,
        description: "Immediately revokes every session/refresh-token they hold. Rejected if this would leave zero ACTIVE platform operators.",
        confirmLabel: "Disable",
        destructive: true,
      });
      if (!confirmed) return;
    }
    try {
      await statusMutation.mutateAsync(status);
      notify({ message: `Operator is now ${status}.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleGrant = async () => {
    if (!selectedCode) return;
    setGrantError(null);
    try {
      await grantMutation.mutateAsync(selectedCode);
      notify({ message: `${selectedCode} granted.`, severity: "success" });
      setSelectedCode("");
    } catch (error) {
      setGrantError(error instanceof ApiError && error.isForbidden ? error.message : getApiErrorMessage(error));
    }
  };

  const handleRevoke = async (code: string) => {
    try {
      await revokeMutation.mutateAsync(code);
      notify({ message: `${code} revoked.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const grantableCodes = ALL_CODES.filter((c) => !operator.permissionCodes.includes(c));

  return (
    <>
      <PageHeader title="Platform Operator" description={operator.userId} onBack={() => navigate("/platform-console/operators")} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip label={operator.status} color={operator.status === "ACTIVE" ? "success" : "default"} />
            {isSelf && <Chip label="This is you" size="small" variant="outlined" />}
          </Stack>
          <FormControl size="small" sx={{ mt: 2, minWidth: 200 }}>
            <InputLabel id="operator-status-label">Status</InputLabel>
            <Select labelId="operator-status-label" label="Status" value={operator.status} onChange={(e) => handleStatusChange(e.target.value as PlatformOperatorStatus)}>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="DISABLED">Disabled</MenuItem>
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Permissions
      </Typography>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {operator.permissionCodes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No permissions granted.
              </Typography>
            ) : (
              operator.permissionCodes.map((code) => (
                <Chip
                  key={code}
                  label={code}
                  onDelete={() => handleRevoke(code)}
                  deleteIcon={
                    <Tooltip title={`Revoke ${code}`}>
                      <IconButton size="small" aria-label={`Revoke ${code}`}>
                        <DeleteOutlineIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  }
                />
              ))
            )}
          </Stack>
        </CardContent>
      </Card>

      {grantError && <Alert severity="error" sx={{ mb: 2 }}>{grantError}</Alert>}
      <Stack direction="row" spacing={1.5}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="grant-permission-label">Grant a permission</InputLabel>
          <Select labelId="grant-permission-label" label="Grant a permission" value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)}>
            {grantableCodes.map((code) => (
              <MenuItem key={code} value={code}>
                {code}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleGrant} disabled={!selectedCode || grantMutation.isPending}>
          Grant
        </Button>
      </Stack>
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
        You can only grant a permission you hold yourself — the backend enforces this (grant-ceiling), not merely this list of options.
      </Typography>
    </>
  );
}
