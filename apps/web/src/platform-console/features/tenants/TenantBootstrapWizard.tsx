import { zodResolver } from "@hookform/resolvers/zod";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useNotify } from "@/app/providers/NotificationProvider";
import { LoadingState } from "@/design-system/components/LoadingState";
import { getApiErrorMessage } from "@/shared/api";
import { listPlatformProducts, type BootstrapTenantResult, type PlatformTenant } from "@/shared/platform-api";

import { useBootstrapPlatformTenantMutation } from "./hooks";

// Mirrors src/modules/tenants/dto/bootstrap-tenant.dto.ts exactly.
const schema = z.object({
  organizationName: z.string().min(1, "Required").max(255, "Must be 255 characters or fewer"),
  organizationCode: z.string().max(30, "Must be 30 characters or fewer").optional(),
  administratorEmail: z.string().min(1, "Required").email("Enter a valid email address"),
  administratorFirstName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
  administratorLastName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
});
type FormValues = z.infer<typeof schema>;

const STEPS = ["Organization", "Administrator", "Product access", "Review"] as const;
const FIELDS_BY_STEP: (keyof FormValues)[][] = [
  ["organizationName", "organizationCode"],
  ["administratorEmail", "administratorFirstName", "administratorLastName"],
  [],
  [],
];

export interface TenantBootstrapWizardProps {
  open: boolean;
  onClose: () => void;
  tenant: PlatformTenant;
  onBootstrapped?: (result: BootstrapTenantResult) => void;
}

/**
 * Phase 2UI.3 — the UI for the Phase 2UI.2 backend capability
 * (POST /platform/tenants/:id/bootstrap, docs/TENANT_BOOTSTRAP.md). The
 * governing brief's own "Step 1 — Tenant Information" is deliberately NOT
 * re-collected here: the tenant this wizard operates on already exists
 * (created via the existing PlatformTenantFormDrawer, which is what
 * "Register tenant" on the Tenants list already does) — this wizard picks
 * up immediately after that, exactly matching the real API shape (bootstrap
 * takes a tenant id in its own URL, not a fresh tenant payload). Shown as
 * a prominent action on PlatformTenantDetailPage whenever a tenant is still
 * PROVISIONING, since an un-bootstrapped tenant has no Organization and no
 * Administrator — nobody can actually use it yet.
 *
 * One real backend call at the final step (POST .../bootstrap) — no raw
 * SQL, no multiple uncontrolled frontend calls standing in for what the
 * one transactional endpoint already does atomically.
 */
export function TenantBootstrapWizard({ open, onClose, tenant, onBootstrapped }: TenantBootstrapWizardProps) {
  const notify = useNotify();
  const [activeStep, setActiveStep] = useState(0);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ["platform", "products", "lookup-active"],
    queryFn: () => listPlatformProducts({ limit: 200 }),
    enabled: open,
  });
  const bootstrapMutation = useBootstrapPlatformTenantMutation(tenant.id);

  const {
    register,
    handleSubmit,
    trigger,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { organizationName: "", organizationCode: "", administratorEmail: "", administratorFirstName: "", administratorLastName: "" },
  });
  const values = watch();

  const handleClose = () => {
    setActiveStep(0);
    setSelectedProductIds([]);
    setSubmitError(null);
    reset();
    onClose();
  };

  const handleNext = async () => {
    const fields = FIELDS_BY_STEP[activeStep];
    if (fields.length > 0) {
      const valid = await trigger(fields);
      if (!valid) return;
    }
    setActiveStep((s) => s + 1);
  };

  const handleBack = () => setActiveStep((s) => s - 1);

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));
  };

  const onSubmit = handleSubmit(async (formValues) => {
    setSubmitError(null);
    try {
      const result = await bootstrapMutation.mutateAsync({
        organizationName: formValues.organizationName,
        organizationCode: formValues.organizationCode || undefined,
        administratorEmail: formValues.administratorEmail,
        administratorFirstName: formValues.administratorFirstName,
        administratorLastName: formValues.administratorLastName,
        productIds: selectedProductIds.length > 0 ? selectedProductIds : undefined,
      });
      notify({ message: `${tenant.tenantName} was bootstrapped — its administrator has been invited.`, severity: "success" });
      handleClose();
      onBootstrapped?.(result);
    } catch (error) {
      // A 409 here is real, meaningful state — either this tenant was
      // already bootstrapped (by this operator moments ago, or by another
      // operator concurrently) or is no longer PROVISIONING. Shown
      // verbatim, not swallowed into a generic message, since the backend
      // message already says which.
      setSubmitError(getApiErrorMessage(error));
    }
  });

  const activeProducts = (productsQuery.data?.items ?? []).filter((p) => p.status === "ACTIVE");

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Bootstrap {tenant.tenantName}
        <Typography variant="body2" color="text.secondary">
          {tenant.tenantCode} — creates its first Organization, Administrator, and (optionally) Product Access, atomically.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {submitError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {submitError}
          </Alert>
        )}

        <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
          {activeStep === 0 && (
            <Stack spacing={2.5}>
              <TextField
                {...register("organizationName")}
                label="Organization name"
                fullWidth
                required
                error={!!errors.organizationName}
                helperText={errors.organizationName?.message ?? "This tenant's first Organization — access context, not an ERP hierarchy."}
              />
              <TextField
                {...register("organizationCode")}
                label="Organization code"
                fullWidth
                error={!!errors.organizationCode}
                helperText={errors.organizationCode?.message ?? `Optional — defaults to "${tenant.tenantCode}-ORG" if left blank.`}
              />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={2.5}>
              <Alert severity="info">
                The administrator is invited by email — they set their own password via the standard invitation flow. No password is collected here.
              </Alert>
              <TextField
                {...register("administratorEmail")}
                label="Email"
                type="email"
                fullWidth
                required
                error={!!errors.administratorEmail}
                helperText={errors.administratorEmail?.message ?? "If this email already has an Identity elsewhere, it's reused — never duplicated."}
              />
              <TextField {...register("administratorFirstName")} label="First name" fullWidth required error={!!errors.administratorFirstName} helperText={errors.administratorFirstName?.message} />
              <TextField {...register("administratorLastName")} label="Last name" fullWidth required error={!!errors.administratorLastName} helperText={errors.administratorLastName?.message} />
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Optional — grant this tenant ACTIVE access to one or more products now. You can always grant more later from this tenant's own Product Access page.
              </Typography>
              {productsQuery.isLoading ? (
                <LoadingState dense />
              ) : activeProducts.length === 0 ? (
                <Typography variant="body2" color="text.disabled">
                  No ACTIVE products are registered on this platform yet.
                </Typography>
              ) : (
                activeProducts.map((product) => (
                  <FormControlLabel
                    key={product.id}
                    control={<Checkbox checked={selectedProductIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />}
                    label={
                      <Stack>
                        <Typography variant="body2">{product.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {product.slug}
                        </Typography>
                      </Stack>
                    }
                  />
                ))
              )}
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack spacing={2}>
              <Typography variant="subtitle2">Review</Typography>
              <List dense disablePadding>
                <ListItem disableGutters>
                  <ListItemText primary="Tenant" secondary={`${tenant.tenantName} (${tenant.tenantCode})`} />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemText primary="Organization" secondary={values.organizationName || "—"} />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemText primary="Administrator" secondary={`${values.administratorFirstName} ${values.administratorLastName} <${values.administratorEmail}>`} />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemText
                    primary="Product access"
                    secondaryTypographyProps={{ component: "div" }}
                    secondary={
                      selectedProductIds.length === 0 ? (
                        "None granted now — can be added later"
                      ) : (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                          {activeProducts
                            .filter((p) => selectedProductIds.includes(p.id))
                            .map((p) => (
                              <Chip key={p.id} label={p.name} size="small" icon={<CheckCircleOutlineIcon />} />
                            ))}
                        </Stack>
                      )
                    }
                  />
                </ListItem>
              </List>
              <Alert severity="warning">This is a single, atomic operation — either everything above is created together, or nothing is. It can only run once per tenant.</Alert>
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        {activeStep > 0 && <Button onClick={handleBack}>Back</Button>}
        {activeStep < STEPS.length - 1 ? (
          <Button variant="contained" onClick={handleNext}>
            Next
          </Button>
        ) : (
          <Button variant="contained" onClick={onSubmit} disabled={bootstrapMutation.isPending}>
            {bootstrapMutation.isPending ? "Bootstrapping…" : "Bootstrap tenant"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
