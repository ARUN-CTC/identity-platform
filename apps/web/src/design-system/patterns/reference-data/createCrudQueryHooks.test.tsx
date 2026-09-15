import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createCrudQueryHooks } from "./createCrudQueryHooks";

interface FakeEntity {
  id: string;
  name: string;
}

function makeFakeSdk() {
  let items: FakeEntity[] = [{ id: "1", name: "Alpha" }];
  return {
    list: vi.fn(async () => ({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } })),
    get: vi.fn(async (id: string) => items.find((item) => item.id === id) as FakeEntity),
    create: vi.fn(async (input: { name: string }) => {
      const entity = { id: "2", ...input };
      items = [...items, entity];
      return entity;
    }),
    update: vi.fn(async (id: string, input: Partial<FakeEntity>) => {
      items = items.map((item) => (item.id === id ? { ...item, ...input } : item));
      return items.find((item) => item.id === id) as FakeEntity;
    }),
    remove: vi.fn(async (id: string) => {
      items = items.filter((item) => item.id !== id);
      return null;
    }),
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("createCrudQueryHooks", () => {
  it("useListQuery moves from loading to success with data", async () => {
    const sdk = makeFakeSdk();
    const hooks = createCrudQueryHooks<FakeEntity, object, { name: string }, Partial<FakeEntity>>("fake", sdk);
    const client = new QueryClient();

    const { result } = renderHook(() => hooks.useListQuery({}), { wrapper: makeWrapper(client) });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ id: "1", name: "Alpha" }]);
  });

  it("useDetailQuery stays disabled until an id is provided", async () => {
    const sdk = makeFakeSdk();
    const hooks = createCrudQueryHooks<FakeEntity, object, { name: string }, Partial<FakeEntity>>("fake", sdk);
    const client = new QueryClient();

    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => hooks.useDetailQuery(id), {
      wrapper: makeWrapper(client),
      initialProps: { id: undefined as string | undefined },
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(sdk.get).not.toHaveBeenCalled();

    rerender({ id: "1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sdk.get).toHaveBeenCalledWith("1");
  });

  it("useCreateMutation invalidates the list query so it refetches", async () => {
    const sdk = makeFakeSdk();
    const hooks = createCrudQueryHooks<FakeEntity, object, { name: string }, Partial<FakeEntity>>("fake", sdk);
    const client = new QueryClient();
    const wrapper = makeWrapper(client);

    const list = renderHook(() => hooks.useListQuery({}), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(sdk.list).toHaveBeenCalledTimes(1);

    const create = renderHook(() => hooks.useCreateMutation(), { wrapper });
    await create.result.current.mutateAsync({ name: "Beta" });

    await waitFor(() => expect(sdk.list).toHaveBeenCalledTimes(2));
  });

  it("useDeleteMutation invalidates the list query after removing an entity", async () => {
    const sdk = makeFakeSdk();
    const hooks = createCrudQueryHooks<FakeEntity, object, { name: string }, Partial<FakeEntity>>("fake", sdk);
    const client = new QueryClient();
    const wrapper = makeWrapper(client);

    const list = renderHook(() => hooks.useListQuery({}), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const del = renderHook(() => hooks.useDeleteMutation(), { wrapper });
    await del.result.current.mutateAsync("1");

    expect(sdk.remove).toHaveBeenCalledWith("1");
    await waitFor(() => expect(sdk.list).toHaveBeenCalledTimes(2));
  });
});
