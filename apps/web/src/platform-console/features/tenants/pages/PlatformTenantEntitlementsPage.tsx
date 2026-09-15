import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
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
      <PageHeader title="Product Entitlements" description="Which products this tenant may use." onBack={() => navigate(`/platform-console/tenants/${id}`)} />

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
              return (
                <ListItem
                  key={entitlement.productId}
                  divider
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
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        {entitlement.product?.name ?? entitlement.productId}
                        <StatusBadge status={meta.statusKey} label={meta.label} />
                      </Stack>
                    }
                    secondary={entitlement.product?.slug}
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
