import { useQuery } from "@tanstack/react-query";

import { listMyProductEntitlements } from "@/shared/api";

const productEntitlementsKeys = {
  mine: ["product-entitlements", "me"] as const,
};

/** No mutations here — see shared/api/product-entitlements.ts's header comment: grant/revoke is Platform-Operator-only, not reachable from this tenant-scoped app. */
export function useMyProductEntitlementsQuery() {
  return useQuery({
    queryKey: productEntitlementsKeys.mine,
    queryFn: () => listMyProductEntitlements(),
  });
}
