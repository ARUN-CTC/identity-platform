import { describe, expect, it } from "vitest";

import { getEventTypeLabel, KNOWN_TENANT_EVENT_TYPES, renderSafeMetadata } from "./eventTypeMeta";

describe("getEventTypeLabel", () => {
  it("returns a friendly label for a known real event type", () => {
    expect(getEventTypeLabel("iam.role_granted")).toBe("Role granted");
    expect(getEventTypeLabel("LOGIN_SUCCESS")).toBe("Login succeeded");
  });

  it("falls back to the raw code for an unrecognized event type — new backend event types still display, never crash", () => {
    expect(getEventTypeLabel("SOME_FUTURE_EVENT")).toBe("SOME_FUTURE_EVENT");
  });
});

describe("KNOWN_TENANT_EVENT_TYPES", () => {
  // Every one of these is genuinely reachable via GET /security-audit/events
  // for a tenant caller — see eventTypeMeta.ts's own header comment for how
  // this list was built (grepping every `securityEvents.record()`, not
  // `recordPlatformEvent()`, call site).
  it("never includes a platform-only or dead event type", () => {
    const values = KNOWN_TENANT_EVENT_TYPES.map((e) => e.value);
    for (const deadOrPlatformOnly of [
      "APPLICATION_CREATED",
      "PRODUCT_CREATED",
      "SERVICE_ACCOUNT_CREATED",
      "PRODUCT_ENTITLEMENT_CREATED",
      "OAUTH_TOKEN_ISSUED", // client-credentials flow — recordPlatformEvent only
      "OAUTH_TOKEN_DENIED",
      "PLATFORM_LOGIN_SUCCESS",
      "PLATFORM_OPERATOR_CREATED",
    ]) {
      expect(values).not.toContain(deadOrPlatformOnly);
    }
  });

  // Phase 2 — Applications/OAuth module: the complete, real
  // authorization_code-flow taxonomy (src/modules/oauth/services/
  // authorize.service.ts + authorization-code-grant.service.ts +
  // controllers/userinfo.controller.ts) — every one of these is written via
  // `securityEvents.record()` (tenant-scoped), never `recordPlatformEvent`.
  // OAUTH_AUTHORIZATION_CODE_REPLAYED was found missing from this list
  // during that module's backend discovery and added here — a genuine gap
  // in the earlier Security & Audit module, not a new capability.
  it("includes every real tenant-scoped OAuth/OIDC event type", () => {
    const values = KNOWN_TENANT_EVENT_TYPES.map((e) => e.value);
    for (const real of [
      "OAUTH_AUTHORIZATION_CODE_ISSUED",
      "OAUTH_AUTHORIZATION_DENIED",
      "OAUTH_AUTHORIZATION_CODE_REDEEMED",
      "OAUTH_AUTHORIZATION_CODE_DENIED",
      "OAUTH_AUTHORIZATION_CODE_REPLAYED",
      "OIDC_ID_TOKEN_ISSUED",
      "OIDC_USERINFO_ACCESSED",
      "OIDC_USERINFO_DENIED",
    ]) {
      expect(values).toContain(real);
    }
  });
});

describe("renderSafeMetadata", () => {
  it("returns an empty list for null/undefined metadata", () => {
    expect(renderSafeMetadata(null)).toEqual([]);
    expect(renderSafeMetadata(undefined)).toEqual([]);
  });

  it("renders ordinary, safe metadata fields as-is", () => {
    expect(renderSafeMetadata({ organizationId: "org-1", isNewIdentity: true, failedCount: 3 })).toEqual([
      { key: "organizationId", value: "org-1" },
      { key: "isNewIdentity", value: "Yes" },
      { key: "failedCount", value: "3" },
    ]);
  });

  // The mandatory requirement: never render a credential, even one that
  // hypothetically ended up in event metadata. This is the actual
  // enforcement mechanism, not just a comment promising good behavior.
  it("strips any key that looks like it could carry a credential, regardless of casing", () => {
    const entries = renderSafeMetadata({
      userId: "u1",
      password: "hunter2",
      accessToken: "eyJhbGciOi...",
      refresh_token: "abc",
      clientSecret: "shh",
      Authorization: "Bearer xyz",
      cookie: "session=abc",
      apiKey: "sk_live_123",
      PRIVATE_KEY: "-----BEGIN KEY-----",
    });

    const keys = entries.map((e) => e.key);
    expect(keys).toEqual(["userId"]);
    expect(entries.find((e) => e.key === "userId")?.value).toBe("u1");
  });

  it("formats a nested object value without ever executing JSON.stringify on the whole metadata blob", () => {
    const entries = renderSafeMetadata({ requestedScopes: ["openid", "profile"] });
    expect(entries).toEqual([{ key: "requestedScopes", value: '["openid","profile"]' }]);
  });
});
