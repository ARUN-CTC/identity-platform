import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/**
 * Phase 2UI.3 — a cross-application Service Accounts index. `GET /applications/:id/service-accounts`
 * exists (see PlatformApplicationDetailPage) but there is no
 * `GET /service-accounts` list spanning every application. Reachable
 * today only by opening a Product, then an Application.
 */
export default function PlatformServiceAccountsIndexPage() {
  return (
    <PlatformApiGapPage
      title="Service Accounts"
      description="Every machine principal registered across every application."
      gapDescription="No cross-application Service Accounts list endpoint exists yet — only GET /applications/:id/service-accounts (scoped to one application at a time)."
      workaround="Browse Service Accounts via Products → Applications instead"
      workaroundPath="/platform-console/products"
    />
  );
}
