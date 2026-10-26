// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_api_lib.json
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentPosts, getAgentProfile, getThread, getTimeline, getWorld, withQuery } from "./endpoints";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOk() {
  const mock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const urlOf = (mock: ReturnType<typeof stubOk>, i = 0) => String(mock.mock.calls[i]?.[0]);

describe("endpoints（単体テスト）", () => {
  it("TC-UT_OWEB-007 withQuery は項目がすべて undefined なら ? を付けない", () => {
    const path = withQuery("/api/timeline", { cursor: undefined, limit: undefined });

    expect(path).toBe("/api/timeline");
  });

  it("TC-UT_OWEB-008 withQuery は 0 と空文字は値として残す", () => {
    const path = withQuery("/api/timeline", { limit: 0, cursor: "" });

    expect(path).toBe("/api/timeline?limit=0&cursor=");
  });

  it("TC-UT_OWEB-009 getWorld は /api/world を呼ぶ", async () => {
    const mock = stubOk();

    await getWorld();

    expect(urlOf(mock)).toBe("/api/world");
  });

  it("TC-UT_OWEB-010 getTimeline は条件なしなら /api/timeline、cursor と limit があればクエリに付ける", async () => {
    const mock = stubOk();

    await getTimeline();
    await getTimeline({ cursor: "c1", limit: 30 });

    expect(urlOf(mock, 0)).toBe("/api/timeline");
    expect(urlOf(mock, 1)).toBe("/api/timeline?cursor=c1&limit=30");
  });

  it("TC-UT_OWEB-011 getThread は postId の / と空白をエンコードし、depth と from を付ける", async () => {
    const mock = stubOk();

    await getThread("a/b c", { depth: 5, from: "01X" });

    expect(urlOf(mock)).toBe("/api/posts/a%2Fb%20c/thread?depth=5&from=01X");
  });

  it("TC-UT_OWEB-012 getAgentProfile と getAgentPosts は agentId をエンコードし、過去投稿には cursor と limit を付ける", async () => {
    const mock = stubOk();

    await getAgentProfile("a/b");
    await getAgentPosts("a/b", { cursor: "c2", limit: 30 });

    expect(urlOf(mock, 0)).toBe("/api/agents/a%2Fb");
    expect(urlOf(mock, 1)).toBe("/api/agents/a%2Fb/posts?cursor=c2&limit=30");
  });
});
