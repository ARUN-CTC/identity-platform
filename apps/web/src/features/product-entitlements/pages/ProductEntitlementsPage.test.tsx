import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { configureApiClient } from "@/shared/api";
import type { MyProductEntitlement } from "@/shared/api";

import ProductEntitlementsPage from "./ProductEntitlementsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function entitlement(overrides: Partial<MyProductEntitlement> = {}): MyProductEntitlement {
  return {
    productId: "prod-1",
    productName: "TravelOS",
    productSlug: "travelos",
    status: "ACTIVE",
    eligible: true,
    ...overrides,
  };
}

function renderPage(fetchImpl: (url: string) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <ProductEntitlementsPage />
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

describe("ProductEntitlementsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests only the caller's own tenant entitlements — no tenant id is ever sent", async () => {
    const fetchMock = renderPage(async (url) => {
      if (new URL(url).pathname.endsWith("/product-entitlements")) return jsonResponse(200, [entitlement()]);
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    expect(await screen.findByText("TravelOS")).toBeInTheDocument();
    // GET /product-entitlements takes no tenantId param at all (the backend
    // derives it from the JWT) — confirm this app never sends one either.
    const call = fetchMock.mock.calls.find((c) => new URL(c[0] as string).pathname.endsWith("/product-entitlements"))!;
    const calledUrl = new URL(call[0] as string);
    expect(calledUrl.searchParams.toString()).toBe("");
  });

  it("shows an empty state when the tenant has no entitlements", async () => {
    renderPage(async () => jsonResponse(200, []));

    expect(await screen.findByText("No product entitlements")).toBeInTheDocument();
  });

  it("shows the real backend error message when the request fails", async () => {
    renderPage(async () => jsonResponse(500, null, "An unexpected error occurred"));

    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });

  it("shows an ACTIVE entitlement as usable with no extra caveat", async () => {
    renderPage(async () => jsonResponse(200, [entitlement({ status: "ACTIVE", eligible: true })]));

    await screen.findByText("TravelOS");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Not currently usable")).not.toBeInTheDocument();
  });

  it("flags an ACTIVE entitlement whose product itself is disabled as not currently usable", async () => {
    renderPage(async () => jsonResponse(200, [entitlement({ status: "ACTIVE", eligible: false })]));

    await screen.findByText("TravelOS");
    expect(screen.getByText("Not currently usable")).toBeInTheDocument();
  });

  it("does not repeat the caveat for a REVOKED entitlement — the status badge already says it's unusable", async () => {
    renderPage(async () => jsonResponse(200, [entitlement({ status: "REVOKED", eligible: false })]));

    await screen.findByText("TravelOS");
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByText("Not currently usable")).not.toBeInTheDocument();
  });

  it("shows a SUSPENDED entitlement's status without the redundant caveat", async () => {
    renderPage(async () => jsonResponse(200, [entitlement({ status: "SUSPENDED", eligible: false })]));

    await screen.findByText("TravelOS");
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.queryByText("Not currently usable")).not.toBeInTheDocument();
  });
});
