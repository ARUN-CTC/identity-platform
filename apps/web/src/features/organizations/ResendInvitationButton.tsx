import Button from "@mui/material/Button";

import { useNotify } from "@/app/providers/NotificationProvider";
import { ApiError, getApiErrorMessage } from "@/shared/api";

import { useResendInvitationMutation } from "./hooks";

/**
 * Only rendered for a still-INVITED member (see OrganizationDetailsPage).
 * Real, backend-enforced failure modes: 409 IAM_USER_ALREADY_ACTIVE (the
 * membership was activated — or removed — since this list loaded; a stale-
 * state case handled by just surfacing the message and letting the member
 * list's own invalidation catch up) and 429 (a resend already went out in
 * the last minute — a genuine server-side cooldown, not something this
 * button debounces itself).
 */
export function ResendInvitationButton({ organizationId, userId, email }: { organizationId: string; userId: string; email: string }) {
  const notify = useNotify();
  const mutation = useResendInvitationMutation(organizationId);

  const handleClick = async () => {
    try {
      await mutation.mutateAsync(userId);
      notify({ message: `Invitation resent to ${email}.`, severity: "success" });
    } catch (error) {
      const message =
        error instanceof ApiError && error.isRateLimited
          ? "An invitation was just sent — please wait a minute before resending."
          : getApiErrorMessage(error);
      notify({ message, severity: error instanceof ApiError && error.isRateLimited ? "warning" : "error" });
    }
  };

  return (
    <Button size="small" onClick={handleClick} disabled={mutation.isPending} loading={mutation.isPending}>
      Resend invitation
    </Button>
  );
}
