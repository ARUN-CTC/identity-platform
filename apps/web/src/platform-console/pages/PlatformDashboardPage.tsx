import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { KpiCard } from "@/design-system/components/KpiCard";
import { PageHeader } from "@/design-system/components/PageHeader";
import { listPlatformAuditEvents, listPlatformProducts, listPlatformTenants } from "@/shared/platform-api";

import { platformNavigation } from "../navigation";
import { PLATFORM_PERMISSIONS } from "../permissions";
import { usePlatformAuth } from "../providers/PlatformAuthProvider";

/**
 * Phase 2UI.1 (docs/IDENTITY_UX_GAP_ANALYSIS.md §5) designed this in two
 * passes. This is Pass 1: KPI tiles wired to data that's genuinely free
 * today — `meta.total` on a list the operator is already permitted (and
 * already paying the request cost) to fetch, never a fabricated number.
 * Deliberately NOT shown here, because no aggregate endpoint exists for
 * any of them yet (see docs/PHASE_2UI3.md's own API Gap table for exactly
 * why, and the recommended phase for each): total Users, total
 * Memberships, per-product tenant-adoption ranking, authentication/OAuth
 * activity rates. Fabricating those from what IS available (e.g. counting
 * rows in one paginated page) would be exactly the misleading dashboard
 * the governing brief warns against — so they're absent, not faked.
 */
export default function PlatformDashboardPage() {
  const navigate = useNavigate();
  const { operator, hasPlatformPermission } = usePlatformAuth();

  const canViewTenants = hasPlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_TENANT_VIEW);
  const canViewProducts = hasPlatformPermission(PLATFORM_PERMISSIONS.PRODUCT_VIEW);
  const canViewAudit = hasPlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_SECURITY_VIEW);

  const tenantsQuery = useQuery({
    queryKey: ["platform", "dashboard", "tenants-count"],
    queryFn: () => listPlatformTenants({ limit: 1 }),
    enabled: canViewTenants,
  });
  const productsQuery = useQuery({
    queryKey: ["platform", "dashboard", "products-count"],
    queryFn: () => listPlatformProducts({ limit: 1 }),
    enabled: canViewProducts,
  });
  const auditQuery = useQuery({
    queryKey: ["platform", "dashboard", "recent-events"],
    queryFn: () => listPlatformAuditEvents({ limit: 5 }),
    enabled: canViewAudit,
  });

  const items = platformNavigation.flatMap((section) => section.items).filter((item) => item.id !== "dashboard" && (!item.permission || hasPlatformPermission(item.permission)));

  return (
    <>
      <PageHeader title="Platform Console" description={operator ? `Signed in as ${operator.email}` : undefined} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {canViewTenants && (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard
              label="Tenants"
              value={tenantsQuery.data?.meta.total}
              loading={tenantsQuery.isLoading}
              caption="Registered on this platform"
              onClick={() => navigate("/platform-console/tenants")}
            />
          </Grid>
        )}
        {canViewProducts && (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KpiCard label="Products" value={productsQuery.data?.meta.total} loading={productsQuery.isLoading} caption="Registered on this platform" onClick={() => navigate("/platform-console/products")} />
          </Grid>
        )}
      </Grid>

      {canViewAudit && auditQuery.data && auditQuery.data.items.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Recent security events
            </Typography>
            <Stack spacing={0.5}>
              {auditQuery.data.items.map((event) => (
                <Stack key={event.id} direction="row" justifyContent="space-between" sx={{ py: 0.5, borderBottom: 1, borderColor: "divider" }}>
                  <Typography variant="body2">{event.eventType}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(event.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" sx={{ display: "block", mt: 1 }}>
              <Link component={RouterLink} to="/platform-console/audit" variant="caption">
                View all platform audit events →
              </Link>
            </Typography>
          </CardContent>
        </Card>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Manage
      </Typography>
      <Grid container spacing={2}>
        {items.map((item) => (
          <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined">
              <CardActionArea onClick={() => navigate(item.path)} sx={{ p: 2 }}>
                <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 0 }}>
                  <item.icon color="action" />
                  <Typography variant="subtitle1">{item.label}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      {items.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Your account holds no platform permissions yet — ask another Platform Operator to grant you access.
        </Typography>
      )}
    </>
  );
}
