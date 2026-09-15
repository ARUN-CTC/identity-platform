import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getApiErrorMessage } from "@/shared/api";

import { useMyProductEntitlementsQuery } from "../hooks";
import { getEntitlementStatusMeta } from "../statusMeta";

/**
 * Read-only, self-service, tenant-wide — this is the ONLY product-
 * entitlement surface a tenant-scoped user can ever reach (see
 * shared/api/product-entitlements.ts's header comment). Granting/revoking a
 * product, and browsing the product catalog itself, are Platform-Operator-
 * only operations (`PRODUCT_ENTITLEMENT_MANAGE`/`PRODUCT_VIEW`, both
 * `platform_only = TRUE`) — not exposed here, not "coming soon", genuinely
 * out of scope for this tenant admin console (see the Phase 2 Product
 * Entitlements verification report's Platform Operator boundary finding).
 *
 * No permission gates this route beyond being signed in — `GET
 * /product-entitlements` requires nothing beyond ordinary tenant
 * authentication (no `PRODUCT_ENTITLEMENT_VIEW` check; that permission is
 * platform_only and could never be granted to a tenant Role in the first
 * place — gating this route on it would be exactly the permanently-dead nav
 * item navigation.ts's own header comment warns against). Every entitlement
 * shown here belongs to the caller's own tenant, scoped server-side from the
 * JWT (`RequestContextService.requireTenantId()`), never a client-supplied
 * id — a real backend guarantee, unlike Tenant Settings' own tenant id
 * restriction (see [[tenant-manage-unscoped-registry-vulnerability]]).
 *
 * There is also no per-user "product role" concept anywhere in this
 * backend: access to a product (at the OAuth/API boundary — see
 * `ProductAccessService.canAccess()`) is decided at the tenant level only
 * (this entitlement's status + the Product's own status), never per user.
 * The `eligible` flag below is that exact backend decision, already
 * computed — this page never re-derives "entitlement row exists" into
 * "usable" itself.
 */
export default function ProductEntitlementsPage() {
  const entitlementsQuery = useMyProductEntitlementsQuery();

  return (
    <>
      <PageHeader
        title="Product Entitlements"
        description="Products your tenant is entitled to use. Granting or revoking a product is managed by the platform operator, not from here."
      />

      <Card>
        {entitlementsQuery.isLoading ? (
          <CardContent>
            <LoadingState dense />
          </CardContent>
        ) : entitlementsQuery.isError ? (
          <CardContent>
            <ErrorState description={getApiErrorMessage(entitlementsQuery.error)} onRetry={() => entitlementsQuery.refetch()} />
          </CardContent>
        ) : !entitlementsQuery.data || entitlementsQuery.data.length === 0 ? (
          <CardContent>
            <EmptyState variant="no-data" title="No product entitlements" description="Your tenant is not entitled to any products yet." />
          </CardContent>
        ) : (
          <List disablePadding>
            {entitlementsQuery.data.map((entitlement) => {
              const statusMeta = getEntitlementStatusMeta(entitlement.status);
              return (
                <ListItem key={entitlement.productId} divider>
                  <ListItemIcon>
                    <ExtensionOutlinedIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {entitlement.productName}
                        </Typography>
                        <StatusBadge status={statusMeta.statusKey} label={statusMeta.label} />
                        {/* Only surfaced when the entitlement itself is ACTIVE but the
                            product still isn't usable — i.e. Product.status !== ACTIVE
                            (ProductAccessService.canAccess()'s precedence rule). When the
                            entitlement is SUSPENDED/REVOKED, the status badge above
                            already says everything `eligible: false` would repeat. */}
                        {entitlement.status === "ACTIVE" && !entitlement.eligible && (
                          <Chip label="Not currently usable" size="small" variant="outlined" />
                        )}
                      </Stack>
                    }
                    secondary={entitlement.productSlug}
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
