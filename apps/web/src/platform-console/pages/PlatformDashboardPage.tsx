import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/design-system/components/PageHeader";

import { platformNavigation } from "../navigation";
import { usePlatformAuth } from "../providers/PlatformAuthProvider";

/**
 * No KPI tiles here — this backend has no aggregate-metrics endpoint
 * (tenant counts, adoption stats, etc.) for this console to call, and
 * fabricating numbers from a single paginated list's `meta.total` (itself
 * gated behind whichever permission the operator happens to hold) would be
 * exactly the misleading dashboard the brief warns against. This is a
 * plain landing page: quick links to whatever this operator can actually
 * reach, nothing else.
 */
export default function PlatformDashboardPage() {
  const navigate = useNavigate();
  const { operator, hasPlatformPermission } = usePlatformAuth();
  const items = platformNavigation.filter((item) => item.id !== "dashboard" && (!item.permission || hasPlatformPermission(item.permission)));

  return (
    <>
      <PageHeader title="Platform Console" description={operator ? `Signed in as ${operator.email}` : undefined} />
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
