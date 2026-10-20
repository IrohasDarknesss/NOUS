import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import type { FollowItem, FollowType } from "../api/types";
import { useFollows } from "./useFollows";

vi.mock("../api/endpoints", () => ({
  getFollows: vi.fn(),
}));

const sampleItem: FollowItem = {
  agentId: "01B",
  handle: "haruka",
  displayName: "ハルカ",
  isAi: true,
  state: "active",
  startedWorldSec: 86400 + 36000,
};

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFollows", () => {
  it.each([
    ["TC-NOUS68_DEV-02", "following" as FollowType],
    ["TC-NOUS68_DEV-03", "followers" as FollowType],
  ])("%s getFollows を type=%s で呼び出して一覧を返す", async (_id, type) => {
    vi.mocked(endpoints.getFollows).mockResolvedValue({ items: [sampleItem] });

    const { result } = renderHook(() => useFollows("01A", type), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(endpoints.getFollows).toHaveBeenCalledWith("01A", type);
    expect(result.current.items).toEqual([sampleItem]);
  });
});
