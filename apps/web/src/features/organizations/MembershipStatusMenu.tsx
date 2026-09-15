import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState, type MouseEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { useNotify } from "@/app/providers/NotificationProvider";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { ADMIN_SETTABLE_MEMBERSHIP_STATUSES, getApiErrorMessage, type AdminSettableMembershipStatus, type Member } from "@/shared/api";

import { useUpdateMembershipStatusMutation } from "./hooks";
import { getMembershipStatusMeta } from "./statusMeta";

const STATUS_ACTION_LABEL: Record<AdminSettableMembershipStatus, string> = {
  ACTIVE: "Reactivate",
  SUSPENDED: "Suspend",
  REMOVED: "Remove",
};

/**
 * The backend enforces NO transition rules on membership status at all —
 * `MembershipsService.setStatus()` accepts any of ACTIVE/SUSPENDED/REMOVED
 * from any current status, unlike User.status's real state machine. Every
 * option other than the member's current status is always offered; the
 * backend is still what actually decides (a 403/404 here is real, not a
 * frontend restriction loosened).
 */
export function MembershipStatusMenu({ organizationId, member }: { organizationId: string; member: Member }) {
  const { user } = useAuth();
  const notify = useNotify();
  const confirm = useConfirm();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const mutation = useUpdateMembershipStatusMutation(organizationId);

  const displayName = [member.user.firstName, member.user.lastName].filter(Boolean).join(" ") || member.user.email;
  const isSelf = member.userId === user?.id;
  const options = ADMIN_SETTABLE_MEMBERSHIP_STATUSES.filter((status) => status !== member.status);

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleSelect = async (status: AdminSettableMembershipStatus) => {
    handleClose();
    const targetMeta = getMembershipStatusMeta(status);
    const confirmed = await confirm({
      title: `${STATUS_ACTION_LABEL[status]} ${displayName}?`,
      description: isSelf
        ? `This is your own membership — you are about to change it to ${targetMeta.label}. This takes effect immediately, and there is no built-in protection against locking yourself out.`
        : `${displayName}'s membership in this organization will change to ${targetMeta.label} immediately.`,
      confirmLabel: STATUS_ACTION_LABEL[status],
      destructive: status !== "ACTIVE",
    });
    if (!confirmed) return;

    try {
      await mutation.mutateAsync({ userId: member.userId, status });
      notify({ message: `${displayName}'s membership is now ${targetMeta.label.toLowerCase()}.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <Button size="small" endIcon={<ExpandMoreIcon />} onClick={handleOpen} disabled={mutation.isPending} loading={mutation.isPending}>
        Change status
      </Button>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose}>
        {options.map((status) => (
          <MenuItem key={status} onClick={() => handleSelect(status)}>
            {STATUS_ACTION_LABEL[status]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
