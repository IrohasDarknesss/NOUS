import { afterEach, describe, expect, it, vi } from "vitest";
import { getFollows, getThread, getTimeline, withQuery } from "./endpoints";

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("endpoints", () => {
  it("TC-NOUS49_DEV-06 withQuery は undefined の項目を付けない", () => {
    expect(withQuery("/api/timeline", { cursor: undefined, limit: 30 })).toBe("/api/timeline?limit=30");
    expect(withQuery("/api/timeline", {})).toBe("/api/timeline");
  });

  it("TC-NOUS49_DEV-07 getTimeline は limit と since を付けて呼ぶ", async () => {
    const fetchMock = stubFetch();
    await getTimeline({ limit: 30, since: "01ABC" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/timeline?limit=30&since=01ABC");
  });

  it("TC-NOUS49_DEV-08 getThread・getFollows は ID をパスに埋め、条件をクエリにする", async () => {
    const fetchMock = stubFetch();
    await getThread("01P", { depth: 5, from: "01Q" });
    await getFollows("01A", "followers");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/posts/01P/thread?depth=5&from=01Q");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/agents/01A/follows?type=followers");
  });
});
