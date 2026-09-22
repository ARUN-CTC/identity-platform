import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/**
 * Phase 2UI.3 — a cross-product Applications index. `GET /products/:id/applications`
 * exists and is fully functional (see PlatformProductDetailPage's own
 * "Applications" section) but there is no `GET /applications` list
 * spanning every product. Reachable today only by opening a Product first.
 */
export default function PlatformApplicationsIndexPage() {
  return (
    <PlatformApiGapPage
      title="Applications"
      description="Every OAuth client registered across every product."
      gapDescription="No cross-product Applications list endpoint exists yet — only GET /products/:id/applications (scoped to one product at a time)."
      workaround="Browse Applications via Products instead"
      workaroundPath="/platform-console/products"
    />
  );
}
