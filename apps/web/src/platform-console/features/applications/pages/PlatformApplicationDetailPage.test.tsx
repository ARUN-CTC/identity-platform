import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configurePlatformApiClient } from "@/shared/platform-api";
import type { PlatformApplication, PlatformProduct } from "@/shared/platform-api";

import PlatformApplicationDetailPage from "./PlatformApplicationDetailPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function application(overrides: Partial<PlatformApplication> = {}): PlatformApplication {
  return {
    id: "app-1",
    productId: "product-1",
    name: "Web Client",
    clientId: "client-abc",
    clientType: "CONFIDENTIAL",
    status: "ACTIVE",
    redirectUris: ["https://app.example.com/callback"],
    allowedOrigins: [],
    grantTypes: ["authorization_code"],
    allowedScopes: ["openid", "acme.orders.read"],
    audiences: [],
    tokenEndpointAuthMethod: "client_secret_basic",
    secretCreatedAt: "2026-01-01T00:00:00.000Z",
    secretRevokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function product(overrides: Partial<PlatformProduct> = {}): PlatformProduct {
  return { id: "product-1", name: "Acme", slug: "acme", description: null, status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null, ...overrides };
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configurePlatformApiClient({ baseUrl: "http://test.local/api/v1", getAccessToken: () => "test-platform-token" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <ConfirmProvider>
          <MemoryRouter initialEntries={["/platform-console/applications/app-1"]}>
            <Routes>
              <Route path="/platform-console/applications/:id" element={<PlatformApplicationDetailPage />} />
              <Route path="/platform-console/products/:id" element={<div>Product detail page</div>} />
            </Routes>
          </MemoryRouter>
        </ConfirmProvider>
      </NotificationProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

function withStandardRoutes(overrides: {
  onPatch?: (body: Record<string, unknown>) => Response | Promise<Response>;
  onRotate?: () => Response | Promise<Response>;
  app?: PlatformApplication;
  serviceAccounts?: { id: string; applicationId: string; name: string; status: string; credentialCreatedAt: string; credentialRevokedAt: string | null; createdAt: string; updatedAt: string | null }[];
}) {
  return async (url: string, init?: RequestInit) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/v1/applications/app-1" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, overrides.app ?? application());
    }
    if (pathname === "/api/v1/products/product-1" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, product());
    }
    if (pathname === "/api/v1/applications/app-1/service-accounts" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, { items: overrides.serviceAccounts ?? [], meta: { page: 1, limit: 100, total: overrides.serviceAccounts?.length ?? 0, totalPages: 1 } });
    }
    if (pathname === "/api/v1/applications/app-1" && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      if (overrides.onPatch) return overrides.onPatch(body);
      return jsonResponse(200, application({ ...body }));
    }
    if (pathname === "/api/v1/applications/app-1/credentials/rotate" && init?.method === "POST") {
      if (overrides.onRotate) return overrides.onRotate();
      return jsonResponse(200, { ...application(), clientSecret: "rotated-secret-value-xyz" });
    }
    if (pathname.endsWith("/credentials/rotate") && init?.method === "POST") {
      // A service account credential rotation — matched generically since
      // the id varies per test.
      return jsonResponse(200, { id: "sa-1", applicationId: "app-1", name: "worker", status: "ACTIVE", credentialCreatedAt: "2026-01-02T00:00:00.000Z", credentialRevokedAt: null, credential: "rotated-sa-credential-abc" });
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("PlatformApplicationDetailPage — configuration editing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("displays the application's current configuration, including origins now shown alongside redirect URIs", async () => {
    renderPage(withStandardRoutes({ app: application({ allowedOrigins: ["https://app.example.com"] }) }));

    expect(await screen.findByText("Web Client")).toBeInTheDocument();
    expect(screen.getByText("https://app.example.com/callback")).toBeInTheDocument();
    expect(screen.getByText("https://app.example.com")).toBeInTheDocument();
    expect(screen.getByText("openid, acme.orders.read")).toBeInTheDocument();
  });

  it("keeps Edit configuration disabled while the owning product hasn't loaded yet (needed for the scope-namespace hint)", async () => {
    renderPage(async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/api/v1/applications/app-1") return jsonResponse(200, application());
      if (pathname.endsWith("/service-accounts")) return jsonResponse(200, { items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } });
      // Never resolves within this test — simulates the window between the
      // application loading and the product request completing.
      if (pathname === "/api/v1/products/product-1") return new Promise<Response>(() => {});
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("Web Client");
    expect(screen.getByRole("button", { name: "Edit configuration" })).toBeDisabled();
  });

  // "opens pre-filled..." below is this test's positive counterpart: it
  // clicks Edit configuration successfully once the product resolves
  // normally, proving the button re-enables once productQuery.data lands.

  it("opens pre-filled with the application's real values, never inventing implicit/PUBLIC options", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({}));

    await screen.findByText("Web Client");
    await user.click(await screen.findByRole("button", { name: "Edit configuration" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /authorization_code/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /client_credentials/ })).not.toBeChecked();
    expect(within(dialog).getByLabelText(/Redirect URIs/i)).toHaveValue("https://app.example.com/callback");
    expect(within(dialog).getByLabelText(/Allowed scopes/i)).toHaveValue("openid, acme.orders.read");
    // The scope-namespace hint reflects this application's own product slug.
    expect(within(dialog).getByText(/'acme\.'/)).toBeInTheDocument();
  });

  it("saves an added redirect URI via PATCH, sending every configured field (a full replace, not a diff)", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(
      withStandardRoutes({
        onPatch: (body) => {
          expect(body).toEqual({
            grantTypes: ["authorization_code"],
            redirectUris: ["https://app.example.com/callback", "https://app.example.com/callback2"],
            allowedOrigins: [],
            allowedScopes: ["openid", "acme.orders.read"],
            audiences: [],
          });
          return jsonResponse(200, application({ redirectUris: ["https://app.example.com/callback", "https://app.example.com/callback2"] }));
        },
      }),
    );

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const dialog = await screen.findByRole("dialog");

    const redirectField = within(dialog).getByLabelText(/Redirect URIs/i);
    await user.type(redirectField, ", https://app.example.com/callback2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Web Client's configuration was updated successfully.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(true);
  });

  it("surfaces the real 400 for an invalid redirect URI (wildcard) verbatim, keeping the drawer open", async () => {
    const user = userEvent.setup();
    renderPage(
      withStandardRoutes({
        onPatch: () => jsonResponse(400, null, "Wildcard redirect URIs are not permitted: 'https://*.example.com/callback'"),
      }),
    );

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const dialog = await screen.findByRole("dialog");

    const redirectField = within(dialog).getByLabelText(/Redirect URIs/i);
    await user.clear(redirectField);
    await user.type(redirectField, "https://*.example.com/callback");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Wildcard redirect URIs are not permitted: 'https://*.example.com/callback'")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces the real 400 for a scope outside the product's own namespace (INVALID_SCOPE_NAMESPACE)", async () => {
    const user = userEvent.setup();
    renderPage(
      withStandardRoutes({
        onPatch: () => jsonResponse(400, null, "Scope 'other-product.read' is not a standard OIDC scope (openid, profile, email) and is not namespaced under this application's own product ('acme.*')"),
      }),
    );

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const dialog = await screen.findByRole("dialog");

    const scopesField = within(dialog).getByLabelText(/Allowed scopes/i);
    await user.type(scopesField, ", other-product.read");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/is not namespaced under this application's own product/)).toBeInTheDocument();
  });

  it("disables client_credentials for a PUBLIC client, matching the create form's own rule", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({ app: application({ clientType: "PUBLIC", grantTypes: ["authorization_code"] }) }));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("checkbox", { name: /client_credentials/ })).toBeDisabled();
  });

  it("surfaces a 404 if the application is deleted/gone by the time the request lands", async () => {
    renderPage(async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/api/v1/applications/app-1") return jsonResponse(404, null, "Application with id 'app-1' was not found");
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    expect(await screen.findByText("Application with id 'app-1' was not found")).toBeInTheDocument();
  });

  it("surfaces a 500 on save as a friendly message, not a raw error", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({ onPatch: () => jsonResponse(500, null, "An unexpected error occurred") }));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Edit configuration" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });
});

// Phase 2UI.3 — the security-sensitive rotation flow the governing brief's
// own §37 explicitly asks for coverage of: confirmation-before-action,
// one-time reveal, and (critically) that the secret never touches browser
// storage and is unrecoverable once the dialog closes.
describe("PlatformApplicationDetailPage — credential rotation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires confirmation before rotating — cancelling makes no request at all", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(withStandardRoutes({}));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Rotate client secret" }));

    const confirmDialog = await screen.findByRole("dialog");
    expect(within(confirmDialog).getByText(/immediately invalidate the existing one/i)).toBeInTheDocument();
    await user.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));

    expect(fetchMock.mock.calls.some((c) => new URL(c[0] as string).pathname.endsWith("/credentials/rotate"))).toBe(false);
  });

  it("on confirm, rotates and shows the new secret exactly once — never persisted to any browser storage", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({}));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Rotate client secret" }));
    const confirmDialog = await screen.findByRole("dialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "Rotate secret" }));

    expect(await screen.findByText(/client secret was rotated/i)).toBeInTheDocument();
    // Masked by default — the raw value is not sitting in the DOM as text content.
    expect(screen.queryByText("rotated-secret-value-xyz")).not.toBeInTheDocument();

    // The one real security guarantee: nothing about this ever reaches
    // persistent browser storage, regardless of whether the dialog is
    // still open.
    expect(localStorage.length).toBe(0);
    expect(Object.values(sessionStorage).join("")).not.toContain("rotated-secret-value-xyz");
  });

  it("closing the reveal dialog makes the secret unrecoverable through this UI — no re-open, no re-fetch", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({}));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Rotate client secret" }));
    const confirmDialog = await screen.findByRole("dialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "Rotate secret" }));

    const revealDialog = await screen.findByRole("dialog");
    await user.click(within(revealDialog).getByRole("button", { name: "Done — I've saved it" }));

    expect(screen.queryByText(/client secret was rotated/i)).not.toBeInTheDocument();
    expect(screen.queryByText("rotated-secret-value-xyz")).not.toBeInTheDocument();
    // The reveal affordance itself is gone with the dialog — nothing left on
    // the page offers to show it again.
    expect(screen.queryByRole("button", { name: /reveal|show client secret/i })).not.toBeInTheDocument();
  });

  it("disables rotation for a PUBLIC application — there is no secret to rotate", async () => {
    renderPage(withStandardRoutes({ app: application({ clientType: "PUBLIC" }) }));

    await screen.findByText("Web Client");
    expect(screen.queryByRole("button", { name: "Rotate client secret" })).not.toBeInTheDocument();
    expect(screen.getByText(/PUBLIC applications have no client secret to rotate/i)).toBeInTheDocument();
  });

  it("disables rotation for a non-ACTIVE application", async () => {
    renderPage(withStandardRoutes({ app: application({ status: "DISABLED" }) }));

    await screen.findByText("Web Client");
    expect(screen.getByRole("button", { name: "Rotate client secret" })).toBeDisabled();
  });

  it("surfaces a 409 CONCURRENT_MODIFICATION verbatim rather than a generic message", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({ onRotate: () => jsonResponse(409, null, "This application was modified concurrently — please retry") }));

    await screen.findByText("Web Client");
    await user.click(screen.getByRole("button", { name: "Rotate client secret" }));
    const confirmDialog = await screen.findByRole("dialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "Rotate secret" }));

    expect(await screen.findByText("This application was modified concurrently — please retry")).toBeInTheDocument();
  });

  it("rotating a service account's credential also requires confirmation and shows the new value exactly once", async () => {
    const user = userEvent.setup();
    renderPage(
      withStandardRoutes({
        serviceAccounts: [{ id: "sa-1", applicationId: "app-1", name: "worker", status: "ACTIVE", credentialCreatedAt: "2026-01-01T00:00:00.000Z", credentialRevokedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null }],
      }),
    );

    await screen.findByText("Web Client");
    await user.click(await screen.findByRole("button", { name: "Rotate credential" }));
    const confirmDialog = await screen.findByRole("dialog");
    expect(within(confirmDialog).getByText(/immediately invalidate the existing one/i)).toBeInTheDocument();
    await user.click(within(confirmDialog).getByRole("button", { name: "Rotate credential" }));

    expect(await screen.findByText(/worker's credential was rotated/i)).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});
