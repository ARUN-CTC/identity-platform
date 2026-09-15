import { describe, expect, it } from "vitest";

import { getMembershipStatusMeta, getOrganizationStatusMeta } from "./statusMeta";

describe("getOrganizationStatusMeta", () => {
  it("maps only the two real backend values (UpdateOrganizationDto's status) — never SUSPENDED/REVOKED, which are not real Organization statuses", () => {
    expect(getOrganizationStatusMeta("ACTIVE")).toEqual({ statusKey: "active", label: "Active" });
    expect(getOrganizationStatusMeta("INACTIVE")).toEqual({ statusKey: "inactive", label: "Inactive" });
  });
});

describe("getMembershipStatusMeta", () => {
  it("maps every real backend status (membership-status.ts's MembershipStatus)", () => {
    expect(getMembershipStatusMeta("INVITED")).toEqual({ statusKey: "pending", label: "Invited" });
    expect(getMembershipStatusMeta("ACTIVE")).toEqual({ statusKey: "active", label: "Active" });
    expect(getMembershipStatusMeta("SUSPENDED")).toEqual({ statusKey: "suspended", label: "Suspended" });
    expect(getMembershipStatusMeta("REMOVED")).toEqual({ statusKey: "inactive", label: "Removed" });
  });
});
