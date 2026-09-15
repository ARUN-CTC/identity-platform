import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { useNotify } from "@/app/providers/NotificationProvider";
import { getApiErrorMessage } from "@/shared/api";

import { useCreateUserMutation, useOrganizationsLookupQuery } from "./hooks";

// Mirrors src/modules/users/dto/create-user.dto.ts
const createUserFormSchema = z.object({
  email: z.string().min(1, "Required").email("Enter a valid email address"),
  organizationId: z.string().min(1, "Select an organization"),
  username: z.string().optional(),
  firstName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
  lastName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
});

type CreateUserFormValues = z.infer<typeof createUserFormSchema>;

function emptyValues(fixedOrganizationId?: string): CreateUserFormValues {
  return { email: "", organizationId: fixedOrganizationId ?? "", username: "", firstName: "", lastName: "" };
}

export interface CreateUserDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Pre-scopes (and hides the picker for) a specific organization — used
   * when opened from that organization's own Members list, where the
   * target is already unambiguous. Omit to show the full organization
   * picker (the Users directory's own "New user" action).
   */
  fixedOrganizationId?: string;
  fixedOrganizationName?: string;
  /** Called after a successful create/add, in addition to the built-in user-list invalidation — e.g. to also invalidate that organization's member list. */
  onCreated?: () => void;
  /** Defaults to true (the Users directory's own behavior). Pass false when opened from an Organization's Members list, where staying on that page is more useful than jumping to the new member's User Details. */
  navigateToNewUser?: boolean;
}

/**
 * Creation is invitation-only (see CreateUserDto's own doc comment): this
 * always onboards the given email into `organizationId`. If that email
 * already resolves to an existing global Identity, the backend silently
 * ignores username/firstName/lastName and just adds a Membership for the
 * existing person instead — the success message reflects that it may not
 * have "created" a brand-new account. There is no separate "add existing
 * member" endpoint (see shared/api/memberships.ts's own doc comment) — this
 * one form serves both the Users directory's "New user" and an
 * Organization's Members list's "Add member".
 */
export function CreateUserDrawer({
  open,
  onClose,
  fixedOrganizationId,
  fixedOrganizationName,
  onCreated,
  navigateToNewUser = true,
}: CreateUserDrawerProps) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const organizationsQuery = useOrganizationsLookupQuery(open && !fixedOrganizationId);
  const createMutation = useCreateUserMutation();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: emptyValues(fixedOrganizationId),
  });

  const handleClose = () => {
    reset(emptyValues(fixedOrganizationId));
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await createMutation.mutateAsync({
        email: values.email,
        organizationId: fixedOrganizationId ?? values.organizationId,
        username: values.username || undefined,
        firstName: values.firstName,
        lastName: values.lastName,
      });
      notify({ message: `${values.email} was added successfully.`, severity: "success" });
      handleClose();
      onCreated?.();
      if (navigateToNewUser) navigate(`/users/${user.id}`);
    } catch (error) {
      // IAM_EMAIL_ALREADY_REGISTERED (409) and validation failures both
      // carry an already-user-facing message — surfaced as-is.
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer
      open={open}
      title="New user"
      description="Adds an existing or brand-new Identity to one of your organizations. An invitation email is sent unless this person already has an active account."
      onClose={handleClose}
      onSubmit={onSubmit}
      submitLabel="Send invitation"
      submitting={isSubmitting}
    >
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}

        <TextField
          {...register("email")}
          label="Email"
          type="email"
          autoComplete="off"
          fullWidth
          required
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <TextField
          {...register("firstName")}
          label="First name"
          fullWidth
          required
          error={!!errors.firstName}
          helperText={errors.firstName?.message}
        />
        <TextField
          {...register("lastName")}
          label="Last name"
          fullWidth
          required
          error={!!errors.lastName}
          helperText={errors.lastName?.message}
        />
        <TextField {...register("username")} label="Username" fullWidth helperText="Optional." />

        {fixedOrganizationId ? (
          <TextField label="Organization" value={fixedOrganizationName ?? fixedOrganizationId} fullWidth disabled />
        ) : (
          <Controller
            name="organizationId"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth required error={!!errors.organizationId} disabled={organizationsQuery.isLoading}>
                <InputLabel id="create-user-org-select-label">Organization</InputLabel>
                <Select {...field} labelId="create-user-org-select-label" label="Organization">
                  {organizationsQuery.data?.items.map((org) => (
                    <MenuItem key={org.id} value={org.id}>
                      {org.organizationName}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.organizationId?.message ?? "Which organization this person is joining."}</FormHelperText>
              </FormControl>
            )}
          />
        )}
      </Stack>
    </FormDrawer>
  );
}
