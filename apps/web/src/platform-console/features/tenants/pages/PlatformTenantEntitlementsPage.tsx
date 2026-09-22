import AddIcon from "@mui/icons-material/Add";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getApiErrorMessage } from "@/shared/api";
import {
  createTenantEntitlement,
  listPlatformProducts,
  listTenantEntitlements,
  reactivateTenantEntitlement,
  updateTenantEntitlementStatus,
  type PatchableEntitlementStatus,
} from "@/shared/platform-api";

function statusMeta(status: string) {
  if (status === "ACTIVE") return { statusKey: "active" as const, label: "Active" };
  if (status === "SUSPENDED") return { statusKey: "suspended" as const, label: "Suspended" };
  return { statusKey: "rejected" as const, label: "Revoked" };
}

/** Per-tenant entitlement management — mirrors the real ACTIVE/SUSPENDED/REVOKED state machine (TenantProductEntitlementsService), reactivate is its own distinct action, never folded into the status PATCH. */
export default function PlatformTenantEntitlementsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  const entitlementsQuery = useQuery({
    queryKey: ["platform", "tenants", id, "entitlements"],
    queryFn: () => listTenantEntitlements(id as string),
    enabled: !!id,
  });
  const productsQuery = useQuery({
    queryKey: ["platform", "products", "lookup"],
    queryFn: () => listPlatformProducts({ limit: 200 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform", "tenants", id, "entitlements"] });

  const grantMutation = useMutation({
    mutationFn: (productId: string) => createTenantEntitlement(id as string, productId),
    onSuccess: invalidate,
  });
  const statusMutation = useMutation({
    mutationFn: ({ productId, status }: { productId: string; status: PatchableEntitlementStatus }) => updateTenantEntitlementStatus(id as string, productId, status),
    onSuccess: invalidate,
  });
  const reactivateMutation = useMutation({
    mutationFn: (productId: string) => reactivateTenantEntitlement(id as string, productId),
    onSuccess: invalidate,
  });

  const handleGrant = async () => {
    if (!selectedProductId) return;
    try {
      await grantMutation.mutateAsync(selectedProductId);
      notify({ message: "Product entitlement created.", severity: "success" });
      setSelectedProductId("");
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleTransition = async (productId: string, status: PatchableEntitlementStatus) => {
    try {
      await statusMutation.mutateAsync({ productId, status });
      notify({ message: `Entitlement ${status === "SUSPENDED" ? "suspended" : status === "REVOKED" ? "revoked" : "activated"}.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleReactivate = async (productId: string) => {
    try {
      await reactivateMutation.mutateAsync(productId);
      notify({ message: "Entitlement reactivated.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  if (entitlementsQuery.isLoading) return <LoadingState label="Loading entitlements…" />;
  if (entitlementsQuery.isError) {
    return <ErrorState title="Unable to load entitlements" description={getApiErrorMessage(entitlementsQuery.error)} onRetry={() => entitlementsQuery.refetch()} />;
  }

  const entitledProductIds = new Set((entitlementsQuery.data ?? []).map((e) => e.productId));
  const grantableProducts = (productsQuery.data?.items ?? []).filter((p) => !entitledProductIds.has(p.id));

  return (
    <>
      <PageHeader title="Product Access" description="Which products this tenant may use — the tenant-level row of this platform's Access Matrix." onBack={() => navigate(`/platform-console/tenants/${id}`)} />

      <Alert severity="info" sx={{ mb: 2 }}>
        This shows tenant-level access only — the underlying fact this console can prove today. Per-user rows (which specific member can reach which product) would need a new backend endpoint joining
        entitlement + membership + organization data; not built yet. Click a row below to see exactly what "access" is based on.
      </Alert>

      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <Select size="small" displayEmpty value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} sx={{ minWidth: 240 }}>
          <MenuItem value="">
            <em>Select a product to grant…</em>
          </MenuItem>
          {grantableProducts.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleGrant} disabled={!selectedProductId || grantMutation.isPending}>
          Grant
        </Button>
      </Stack>

      <Card>
        {!entitlementsQuery.data || entitlementsQuery.data.length === 0 ? (
          <EmptyState variant="no-data" title="No product entitlements" description="Grant a product above to get started." />
        ) : (
          <List disablePadding>
            {entitlementsQuery.data.map((entitlement) => {
              const meta = statusMeta(entitlement.status);
              const isExpanded = expandedProductId === entitlement.productId;
              return (
                <Stack key={entitlement.productId}>
                  <ListItem
                    divider={!isExpanded}
                    disablePadding
                    secondaryAction={
                      <Stack direction="row" spacing={1}>
                        {entitlement.status === "ACTIVE" && (
                          <Button size="small" color="warning" onClick={() => handleTransition(entitlement.productId, "SUSPENDED")}>
                            Suspend
                          </Button>
                        )}
                        {entitlement.status === "SUSPENDED" && (
                          <Button size="small" color="success" onClick={() => handleTransition(entitlement.productId, "ACTIVE")}>
                            Activate
                          </Button>
                        )}
                        {entitlement.status !== "REVOKED" && (
                          <Button size="small" color="error" onClick={() => handleTransition(entitlement.productId, "REVOKED")}>
                            Revoke
                          </Button>
                        )}
                        {entitlement.status === "REVOKED" && (
                          <Button size="small" color="success" onClick={() => handleReactivate(entitlement.productId)}>
                            Reactivate
                          </Button>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => setExpandedProductId(isExpanded ? null : entitlement.productId)}
                          aria-label={isExpanded ? `Hide basis for ${entitlement.product?.name ?? entitlement.productId}` : `Show basis for ${entitlement.product?.name ?? entitlement.productId}`}
                        >
                          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </IconButton>
                      </Stack>
                    }
                  >
                    <ListItemButton onClick={() => setExpandedProductId(isExpanded ? null : entitlement.productId)} sx={{ pr: 20 }}>
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center">
                            {entitlement.product?.name ?? entitlement.productId}
                            <StatusBadge status={meta.statusKey} label={meta.label} />
                          </Stack>
                        }
                        secondary={entitlement.product?.slug}
                      />
                    </ListItemButton>
                  </ListItem>
                  <Collapse in={isExpanded} unmountOnExit>
                    <Stack spacing={0.5} sx={{ px: 2, py: 1.5, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase" }}>
                        Basis for this access
                      </Typography>
                      <Typography variant="body2">
                        Tenant Product Entitlement: <strong>{entitlement.status}</strong>
                      </Typography>
                      <Typography variant="body2">Granted: {new Date(entitlement.createdAt).toLocaleString()}</Typography>
                      {entitlement.updatedAt && <Typography variant="body2">Last changed: {new Date(entitlement.updatedAt).toLocaleString()}</Typography>}
                      <Typography variant="caption" color="text.disabled">
                        This is the complete, real basis this platform can show today — which specific members can reach this product (their own Membership/Organization) isn't joined here yet;
                        this entitlement is the tenant-wide gate every member's access still depends on.
                      </Typography>
                    </Stack>
                  </Collapse>
                </Stack>
              );
            })}
          </List>
        )}
      </Card>
    </>
  );
}
