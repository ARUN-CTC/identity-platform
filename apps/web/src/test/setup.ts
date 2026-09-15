import "@testing-library/jest-dom/vitest";
import type * as SharedApi from "@/shared/api";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect, vi } from "vitest";

expect.extend(toHaveNoViolations);

/**
 * AuthProvider's dev-bootstrap effect (see app/providers/AuthProvider.tsx)
 * starts async work — login()/getCurrentUser()/listMyOrganizations() calls,
 * mocked below, but still real promise chains needing at least a few
 * microtask ticks — on every mount, with no cancellation on unmount
 * (deliberate, per that file's own comment on why). A test that finishes
 * before that chain settles lets it leak past its own test/file boundary;
 * when it finally resolves against a jsdom environment Vitest has already
 * torn down for the *next* file, it crashes with "window is not defined",
 * attributed to whatever happens to be running at that moment — not the
 * test that actually caused it. A single macrotask flush after every test
 * is enough: the JS event loop fully drains the microtask queue (every
 * already-scheduled promise .then/await continuation, however many steps
 * long the chain is) before any macrotask callback — including this one —
 * runs.
 */
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function base64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Structurally valid but unsigned — fine, decodeJwtPayload never verifies signatures. */
const FAKE_ACCESS_TOKEN = [
  base64url({ alg: "none", typ: "JWT" }),
  base64url({ sub: "test-user-id", tenantId: "test-tenant-id", sessionId: "test-session-id", email: "dev@test.local" }),
  "test-signature",
].join(".");

/**
 * AuthProvider performs a real network login (and a follow-up GET /auth/me
 * + GET /me/organizations) on mount (see app/providers/AuthProvider.tsx) —
 * every test that renders it (i.e. anything using renderWithProviders/
 * AppProviders) would otherwise try to reach a real backend that isn't
 * running during `npm test`. Mock just `login`/`getCurrentUser`/
 * `listMyOrganizations`, keep the rest of shared/api real (apiRequest,
 * ApiError, ...) so tests like shared/api/client.test.ts still exercise
 * actual behavior.
 */
vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    login: vi.fn().mockResolvedValue({
      accessToken: FAKE_ACCESS_TOKEN,
      refreshToken: "test-refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    }),
    getCurrentUser: vi.fn().mockResolvedValue({
      user: { id: "test-user-id", email: "dev@test.local", username: null, firstName: "Dev", lastName: "User", status: "ACTIVE" },
      tenant: { id: "test-tenant-id", tenantCode: "DEFAULT", tenantName: "Default Tenant" },
      organizationContext: { organizationId: null, organizationName: null },
      roles: [{ id: "test-role-id", roleCode: "TENANT_ADMIN", roleName: "Tenant Administrator" }],
      permissions: [],
      session: { id: "test-session-id", expiresAt: "2999-01-01T00:00:00.000Z" },
    }),
    listMyOrganizations: vi.fn().mockResolvedValue([]),
  };
});

/**
 * jsdom doesn't implement matchMedia (it throws "not implemented"), and MUI
 * (useMediaQuery, prefers-color-scheme detection) calls it on mount —
 * without this every test touching ThemeModeProvider or useBreakpoint fails.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

/** jsdom has no ResizeObserver — MUI X DataGrid requires one to measure/virtualize. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
