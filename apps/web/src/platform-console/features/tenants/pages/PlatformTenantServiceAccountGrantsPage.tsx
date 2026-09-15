import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage } from "@/shared/api";
import { listServiceAccountGrantsForTenant, reactivateServiceAccountGrant, updateServiceAccountGrantStatus, type PatchableGrantStatus } from "@/shared/platform-api";

/**
 * Read + lifecycle-only — creating a NEW grant requires picking a
 * ServiceAccount, which is scoped to a specific Application (this page
 * intentionally doesn't duplicate a whole service-account picker here);
 * grant creation for a given (tenant, serviceAccount) pair is available
 * from the ServiceAccount's own owning Application detail page in a
 * future pass. This page's job — list what's already granted, and change
 * status — is complete and real today.
 */
export default function PlatformTenantServiceAccountGrantsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();

  const grantsQuery = useQuery({
    queryKey: ["platform", "tenants", id, "service-account-grants"],
    queryFn: () => listServiceAccountGrantsForTenant(id as string),
    enabled: !!id,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform", "tenants", id, "service-account-grants"] });
  const statusMutation = useMutation({
    mutationFn: ({ serviceAccountId, status }: { serviceAccountId: string; status: PatchableGrantStatus }) => updateServiceAccountGrantStatus(id as string, serviceAccountId, status),
    onSuccess: invalidate,
  });
  const reactivateMutation = useMutation({
    mutationFn: (serviceAccountId: string) => reactivateServiceAccountGrant(id as string, serviceAccountId),
    onSuccess: invalidate,
  });

  const handleTransition = async (serviceAccountId: string, status: PatchableGrantStatus) => {
    try {
      await statusMutation.mutateAsync({ serviceAccountId, status });
      notify({ message: "Grant updated.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleReactivate = async (serviceAccountId: string) => {
    try {
      await reactivateMutation.mutateAsync(serviceAccountId);
      notify({ message: "Grant reactivated.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  if (grantsQuery.isLoading) return <LoadingState label="Loading service account grants…" />;
  if (grantsQuery.isError) {
    return <ErrorState title="Unable to load grants" description={getApiErrorMessage(grantsQuery.error)} onRetry={() => grantsQuery.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Service Account Grants"
        description="Which machine identities (service accounts) are authorized to act on this tenant. A grant answers only that question — product access is still governed independently by Product Entitlements."
        onBack={() => navigate(`/platform-console/tenants/${id}`)}
      />
      <Card>
        {(grantsQuery.data ?? []).length === 0 ? (
          <EmptyState variant="no-data" title="No service accounts are authorized for this tenant" />
        ) : (
          <List disablePadding>
            {(grantsQuery.data ?? []).map((grant) => (
              <ListItem
                key={grant.serviceAccountId}
                divider
                secondaryAction={
                  <Stack direction="row" spacing={1}>
                    {grant.status === "ACTIVE" && (
                      <Button size="small" color="warning" onClick={() => handleTransition(grant.serviceAccountId, "SUSPENDED")}>
                        Suspend
                      </Button>
                    )}
                    {grant.status === "SUSPENDED" && (
                      <Button size="small" color="success" onClick={() => handleTransition(grant.serviceAccountId, "ACTIVE")}>
                        Activate
                      </Button>
                    )}
                    {grant.status !== "REVOKED" && (
                      <Button size="small" color="error" onClick={() => handleTransition(grant.serviceAccountId, "REVOKED")}>
                        Revoke
                      </Button>
                    )}
                    {grant.status === "REVOKED" && (
                      <Button size="small" color="success" onClick={() => handleReactivate(grant.serviceAccountId)}>
                        Reactivate
                      </Button>
                    )}
                  </Stack>
                }
              >
                <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center">{grant.serviceAccount?.name ?? grant.serviceAccountId}<Chip label={grant.status} size="small" /></Stack>} />
              </ListItem>
            ))}
          </List>
        )}
      </Card>
    </>
  );
}
