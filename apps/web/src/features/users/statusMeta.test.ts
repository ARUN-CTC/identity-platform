import { describe, expect, it } from "vitest";

import { getUserStatusMeta } from "./statusMeta";

describe("getUserStatusMeta", () => {
  it("maps every real backend status (UserQueryDto's UserStatus) to a StatusBadge-renderable key", () => {
    expect(getUserStatusMeta("PROVISIONED")).toEqual({ statusKey: "pending", label: "Invited" });
    expect(getUserStatusMeta("ACTIVE")).toEqual({ statusKey: "active", label: "Active" });
    expect(getUserStatusMeta("SUSPENDED")).toEqual({ statusKey: "suspended", label: "Suspended" });
    expect(getUserStatusMeta("DEACTIVATED")).toEqual({ statusKey: "inactive", label: "Deactivated" });
  });
});
