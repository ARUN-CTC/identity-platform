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
import { useEffect, useState } from "react";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { useNotify } from "@/app/providers/NotificationProvider";
import { getApiErrorMessage, type Organization } from "@/shared/api";

import { useCreateOrganizationMutation, useOrganizationTypesLookupQuery, useUpdateOrganizationMutation } from "./hooks";

// Mirrors src/modules/organizations/dto/create-organization.dto.ts +
// update-organization.dto.ts (status is edit-only; organizationCode is
// immutable after creation — OmitType on the backend).
const baseSchema = {
  organizationTypeId: z.string().min(1, "Select an organization type"),
  organizationName: z.string().min(1, "Required").max(255, "Must be 255 characters or fewer"),
  legalName: z.string().optional(),
  email: z.union([z.string().email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
};

const createSchema = z.object({
  ...baseSchema,
  organizationCode: z.string().min(1, "Required").max(50, "Must be 50 characters or fewer"),
});

const editSchema = z.object({
  ...baseSchema,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface OrganizationFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Omit to create; pass the organization being edited to switch modes. */
  organization?: Organization;
  onSaved?: (organization: Organization) => void;
}

export function OrganizationFormDrawer({ open, onClose, organization, onSaved }: OrganizationFormDrawerProps) {
  return organization ? (
    <EditOrganizationForm key={organization.id} open={open} onClose={onClose} organization={organization} onSaved={onSaved} />
  ) : (
    <CreateOrganizationForm open={open} onClose={onClose} onSaved={onSaved} />
  );
}

function CreateOrganizationForm({ open, onClose, onSaved }: Omit<OrganizationFormDrawerProps, "organization">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const typesQuery = useOrganizationTypesLookupQuery(open);
  const createMutation = useCreateOrganizationMutation();

  const EMPTY: CreateFormValues = { organizationTypeId: "", organizationCode: "", organizationName: "", legalName: "", email: "", phone: "", website: "" };
  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY,
  });

  const handleClose = () => {
    reset(EMPTY);
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const organization = await createMutation.mutateAsync({
        organizationTypeId: values.organizationTypeId,
        organizationCode: values.organizationCode,
        organizationName: values.organizationName,
        legalName: values.legalName || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        website: values.website || undefined,
      });
      notify({ message: `${values.organizationName} was created successfully.`, severity: "success" });
      handleClose();
      onSaved?.(organization);
    } catch (error) {
      // A duplicate organizationCode within this tenant surfaces as a
      // database-uniqueness 409 (see AllExceptionsFilter's Prisma P2002
      // mapping) — already a real, user-facing message.
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="New organization" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField {...register("organizationCode")} label="Organization code" fullWidth required error={!!errors.organizationCode} helperText={errors.organizationCode?.message ?? "Cannot be changed after creation."} />
        <TextField {...register("organizationName")} label="Organization name" fullWidth required error={!!errors.organizationName} helperText={errors.organizationName?.message} />
        <Controller
          name="organizationTypeId"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth required error={!!errors.organizationTypeId} disabled={typesQuery.isLoading}>
              <InputLabel id="org-type-select-label">Organization type</InputLabel>
              <Select {...field} labelId="org-type-select-label" label="Organization type">
                {(typesQuery.data?.items ?? []).map((type) => (
                  <MenuItem key={type.id} value={type.id}>
                    {type.typeName}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{errors.organizationTypeId?.message}</FormHelperText>
            </FormControl>
          )}
        />
        <TextField {...register("legalName")} label="Legal name" fullWidth helperText="Optional." />
        <TextField {...register("email")} label="Email" type="email" fullWidth error={!!errors.email} helperText={errors.email?.message ?? "Optional."} />
        <TextField {...register("phone")} label="Phone" fullWidth helperText="Optional." />
        <TextField {...register("website")} label="Website" fullWidth helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}

function EditOrganizationForm({ open, onClose, organization, onSaved }: Required<Pick<OrganizationFormDrawerProps, "organization">> & Omit<OrganizationFormDrawerProps, "organization">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const typesQuery = useOrganizationTypesLookupQuery(open);
  const updateMutation = useUpdateOrganizationMutation(organization.id);

  const defaults: EditFormValues = {
    organizationTypeId: organization.organizationTypeId,
    organizationName: organization.organizationName,
    legalName: organization.legalName ?? "",
    email: organization.email ?? "",
    phone: organization.phone ?? "",
    website: organization.website ?? "",
    status: organization.status,
  };
  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: defaults,
  });

  // Re-sync if a fresher organization record arrives (e.g. after a refetch) while the drawer is closed between opens.
  useEffect(() => {
    if (open) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open with the latest organization snapshot only
  }, [open, organization.id]);

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await updateMutation.mutateAsync({
        organizationTypeId: values.organizationTypeId,
        organizationName: values.organizationName,
        legalName: values.legalName || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        website: values.website || undefined,
        status: values.status,
      });
      notify({ message: `${values.organizationName} was updated successfully.`, severity: "success" });
      handleClose();
      onSaved?.(updated);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit organization" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Organization code" value={organization.organizationCode} fullWidth disabled helperText="Cannot be changed after creation." />
        <TextField {...register("organizationName")} label="Organization name" fullWidth required error={!!errors.organizationName} helperText={errors.organizationName?.message} />
        <Controller
          name="organizationTypeId"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth required error={!!errors.organizationTypeId} disabled={typesQuery.isLoading}>
              <InputLabel id="org-type-select-label-edit">Organization type</InputLabel>
              <Select {...field} labelId="org-type-select-label-edit" label="Organization type">
                {(typesQuery.data?.items ?? []).map((type) => (
                  <MenuItem key={type.id} value={type.id}>
                    {type.typeName}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{errors.organizationTypeId?.message}</FormHelperText>
            </FormControl>
          )}
        />
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth required>
              <InputLabel id="org-status-select-label">Status</InputLabel>
              <Select {...field} labelId="org-status-select-label" label="Status">
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="INACTIVE">Inactive</MenuItem>
              </Select>
            </FormControl>
          )}
        />
        <TextField {...register("legalName")} label="Legal name" fullWidth helperText="Optional." />
        <TextField {...register("email")} label="Email" type="email" fullWidth error={!!errors.email} helperText={errors.email?.message ?? "Optional."} />
        <TextField {...register("phone")} label="Phone" fullWidth helperText="Optional." />
        <TextField {...register("website")} label="Website" fullWidth helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}
