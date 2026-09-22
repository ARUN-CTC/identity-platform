import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { listSigningKeys } from "@/shared/platform-api";

/**
 * Phase 2UI.3 — read-only, backed by the real, public
 * GET /.well-known/jwks.json (never a private key — that endpoint
 * structurally cannot expose one; JWKS is public-key-only by definition).
 * No editing, no rotation trigger here — key rotation is a manual,
 * documented operational procedure (docs/KEY_MANAGEMENT_ARCHITECTURE.md
 * §7, docs/SECURITY_OPERATIONS_RUNBOOK.md §2), performed by changing the
 * OAUTH_PRIVATE_KEY/OAUTH_RETIRED_PUBLIC_KEYS environment variables and
 * restarting — never through this UI, matching the governing brief's own
 * explicit "do NOT create a frontend key rotation mechanism unless the
 * backend explicitly supports the operation safely" (it doesn't).
 */
export default function PlatformSigningKeysPage() {
  const keysQuery = useQuery({ queryKey: ["platform", "signing-keys"], queryFn: listSigningKeys });

  return (
    <>
      <PageHeader title="Signing Keys" description="The public keys this platform currently publishes for external token verification." />

      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2 }}>
        Read-only — sourced live from this platform's own public JWKS endpoint. Key rotation is a manual operational
        procedure (environment variables + restart), never available through this console.
      </Alert>

      {keysQuery.isLoading ? (
        <LoadingState label="Loading signing keys…" />
      ) : keysQuery.isError ? (
        <ErrorState title="Unable to load signing keys" description={keysQuery.error instanceof Error ? keysQuery.error.message : "Unknown error"} onRetry={() => keysQuery.refetch()} />
      ) : !keysQuery.data || keysQuery.data.length === 0 ? (
        <EmptyState variant="no-data" title="No signing keys published" />
      ) : (
        <Card>
          <List disablePadding>
            {keysQuery.data.map((key) => (
              <ListItem key={key.kid} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <code>{key.kid}</code>
                    </Stack>
                  }
                  secondary={`Algorithm: ${key.alg ?? "—"} · Use: ${key.use ?? "—"} · Type: ${key.kty}`}
                />
              </ListItem>
            ))}
          </List>
        </Card>
      )}
    </>
  );
}
