import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useNotify } from "@/app/providers/NotificationProvider";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { ApiError, getApiErrorMessage, type User, type UserStatus } from "@/shared/api";

import { useUserLifecycleMutation, type UserLifecycleAction } from "./hooks";

// Mirrors LIFECYCLE_TRANSITIONS in src/modules/users/services/users.service.ts
// exactly — the buttons this offers per status. The backend re-validates
// the transition independently on every call (this is a UX convenience,
// never the authorization boundary): a status change made in another tab/
// browser between this page loading and a button being pressed still
// surfaces as a real 400 INVALID_USER_TRANSITION here, not a silent no-op.
const AVAILABLE_ACTIONS: Record<UserStatus, UserLifecycleAction[]> = {
  PROVISIONED: ["activate", "deactivate"],
  ACTIVE: ["suspend", "deactivate"],
  SUSPENDED: ["activate", "deactivate"],
  DEACTIVATED: [],
};

const ACTION_CONFIG: Record<
  UserLifecycleAction,
  {
    label: string;
    /** Irregular past tense — "suspend" doesn't become "suspendd" by just appending "d". */
    pastTense: string;
    confirmTitle: (name: string) => string;
    confirmDescription: (name: string) => string;
    destructive: boolean;
  }
> = {
  activate: {
    label: "Activate",
    pastTense: "activated",
    confirmTitle: (name) => `Activate ${name}?`,
    confirmDescription: () =>
      "This restores full access. A still-invited user with no password yet cannot be activated directly — resend their invitation instead.",
    destructive: false,
  },
  suspend: {
    label: "Suspend",
    pastTense: "suspended",
    confirmTitle: (name) => `Suspend ${name}?`,
    confirmDescription: (name) =>
      `${name} will immediately lose access and be signed out of every active session. They can be reactivated later.`,
    destructive: true,
  },
  deactivate: {
    label: "Deactivate",
    pastTense: "deactivated",
    confirmTitle: (name) => `Deactivate ${name}?`,
    confirmDescription: (name) =>
      `${name} will immediately lose access and be signed out of every active session. This is a terminal state — there is no way to reactivate from it.`,
    destructive: true,
  },
};

export function UserLifecycleActions({ user }: { user: User }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const actions = AVAILABLE_ACTIONS[user.status];

  if (actions.length === 0) {
    return (
      <Typography variant="body2" color="text.disabled">
        Deactivated is a terminal state — no further lifecycle actions are available.
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={1}>
      {actions.map((action) => (
        <LifecycleButton key={action} userId={user.id} action={action} displayName={displayName} confirm={confirm} notify={notify} />
      ))}
    </Stack>
  );
}

function LifecycleButton({
  userId,
  action,
  displayName,
  confirm,
  notify,
}: {
  userId: string;
  action: UserLifecycleAction;
  displayName: string;
  confirm: ReturnType<typeof useConfirm>;
  notify: ReturnType<typeof useNotify>;
}) {
  const config = ACTION_CONFIG[action];
  const mutation = useUserLifecycleMutation(userId, action);

  const handleClick = async () => {
    const confirmed = await confirm({
      title: config.confirmTitle(displayName),
      description: config.confirmDescription(displayName),
      confirmLabel: config.label,
      destructive: config.destructive,
    });
    if (!confirmed) return;

    try {
      await mutation.mutateAsync();
      notify({ message: `${displayName} was ${config.pastTense} successfully.`, severity: "success" });
    } catch (error) {
      // A specific backend message (INVALID_USER_TRANSITION,
      // IAM_USER_HAS_NO_PASSWORD) is always more useful here than the
      // generic getApiErrorMessage() 400 fallback would be — those are
      // already written for an end user (see AllExceptionsFilter).
      const message = error instanceof ApiError && error.status === 400 ? error.message : getApiErrorMessage(error);
      notify({ message, severity: "error" });
    }
  };

  return (
    <Button
      variant="outlined"
      color={config.destructive ? "error" : "primary"}
      onClick={handleClick}
      loading={mutation.isPending}
      disabled={mutation.isPending}
    >
      {config.label}
    </Button>
  );
}
