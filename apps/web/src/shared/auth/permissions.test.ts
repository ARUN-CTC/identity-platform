import { describe, expect, it } from "vitest";

import { isKnownPermissionCode, PERMISSIONS } from "./permissions";

describe("PERMISSIONS registry", () => {
  // Mutating the permission catalog itself (create/update/delete) is
  // gated on ROLE_MANAGE server-side, not a separate PERMISSION_MANAGE
  // code — confirmed by grepping the entire backend (zero references to
  // PERMISSION_MANAGE anywhere). Regression test for that finding, in the
  // same spirit as navigation.test.ts's SESSION_MANAGE guard: never
  // invent this code just because it would be the "obvious" symmetric
  // name next to PERMISSION_VIEW.
  it("has no PERMISSION_MANAGE code — permission-catalog mutation is gated on ROLE_MANAGE", () => {
    expect(Object.keys(PERMISSIONS)).not.toContain("PERMISSION_MANAGE");
  });

  it("recognizes every real tenant-scope code used across the app", () => {
    for (const code of ["USER_VIEW", "USER_MANAGE", "ROLE_VIEW", "ROLE_MANAGE", "PERMISSION_VIEW", "ORGANIZATION_MANAGE", "TENANT_MANAGE", "SECURITY_AUDIT_VIEW"]) {
      expect(isKnownPermissionCode(code)).toBe(true);
    }
  });

  it("rejects an invented code", () => {
    expect(isKnownPermissionCode("PERMISSION_MANAGE")).toBe(false);
    expect(isKnownPermissionCode("ROLE_ASSIGN")).toBe(false);
  });
});
