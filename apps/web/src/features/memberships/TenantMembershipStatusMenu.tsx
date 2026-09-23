import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState, type MouseEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { useNotify } from "@/app/providers/NotificationProvider";
import { getMembershipStatusMeta } from "@/features/organizations/statusMeta";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { ADMIN_SETTABLE_MEMBERSHIP_STATUSES, getApiErrorMessage, type AdminSettableMembershipStatus, type TenantMember } from "@/shared/api";

import { useUpdateTenantMembershipStatusMutation } from "./hooks";

const STATUS_ACTION_LABEL: Record<AdminSettableMembershipStatus, string> = {
  ACTIVE: "Reactivate",
  SUSPENDED: "Suspend",
  REMOVED: "Remove",
};

/**
 * The tenant-wide list's own status-change control — same behavior as
 * organizations/MembershipStatusMenu, but backed by
 * useUpdateTenantMembershipStatusMutation() so a change made here
 * invalidates THIS list's own query cache (organizationId varies per row
 * here, unlike the per-organization Members tab, so the bound
 * useUpdateMembershipStatusMutation(organizationId) that component uses
 * isn't a fit — see hooks.ts's doc comment).
 */
export function TenantMembershipStatusMenu({ member }: { member: TenantMember }) {
  const { user } = useAuth();
  const notify = useNotify();
  const confirm = useConfirm();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const mutation = useUpdateTenantMembershipStatusMutation();

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
        ? `This is your own membership in ${member.organization.organizationName} — you are about to change it to ${targetMeta.label}. This takes effect immediately, and there is no built-in protection against locking yourself out.`
        : `${displayName}'s membership in ${member.organization.organizationName} will change to ${targetMeta.label} immediately.`,
      confirmLabel: STATUS_ACTION_LABEL[status],
      destructive: status !== "ACTIVE",
    });
    if (!confirmed) return;

    try {
      await mutation.mutateAsync({ organizationId: member.organization.id, userId: member.userId, status });
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
