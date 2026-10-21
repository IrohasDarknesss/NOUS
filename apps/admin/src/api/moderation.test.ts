import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../session/csrfToken";
import { mockFetch } from "../test/fetchMock";
import { hidePost, listAgents, listHideRecords, searchPosts, unhidePost } from "./moderation";

describe("api/moderation", () => {
  beforeEach(() => setCsrfToken("csrf-mod"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it("TC-NOUS72_DEV-01 searchPosts は条件をクエリ文字列にして GET し、undefined の項目は含めない", async () => {
    const mock = mockFetch({
      "GET /admin/api/posts": { status: 200, body: { items: [], nextCursor: null } },
    });

    await searchPosts({
      q: "朝ごはん",
      visibility: "public",
      agentId: undefined,
      postId: undefined,
      cursor: "cur-1",
      limit: 50,
    });

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0]!;
    expect(init?.method ?? "GET").toBe("GET");
    expect(url).toBe(`/admin/api/posts?q=${encodeURIComponent("朝ごはん")}&visibility=public&cursor=cur-1&limit=50`);
  });

  it("TC-NOUS72_DEV-02 hidePost と unhidePost は postId をエンコードして POST し、本文に reason を送る", async () => {
    const mock = mockFetch({
      "POST /admin/api/posts/post%2F1/hide": {
        status: 200,
        body: { postId: "post/1", visibility: "hidden" },
      },
      "POST /admin/api/posts/post%2F1/unhide": {
        status: 200,
        body: { postId: "post/1", visibility: "public" },
      },
    });

    const hideRes = await hidePost("post/1", { reason: "不適切な表現" });
    expect(hideRes).toEqual({ postId: "post/1", visibility: "hidden" });
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/posts/post%2F1/hide");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(mock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ reason: "不適切な表現" }));

    const unhideRes = await unhidePost("post/1", {});
    expect(unhideRes).toEqual({ postId: "post/1", visibility: "public" });
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/posts/post%2F1/unhide");
    expect(mock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(mock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({}));
  });

  it("TC-NOUS72_DEV-03 listHideRecords と listAgents はクエリ文字列を付けて GET する", async () => {
    const mock = mockFetch({
      "GET /admin/api/hide-records": { status: 200, body: { items: [], nextCursor: null } },
      "GET /admin/api/agents": { status: 200, body: { items: [], worldState: "running" } },
    });

    await listHideRecords({ cursor: "c-2", limit: 20 });
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/hide-records?cursor=c-2&limit=20");

    await listAgents({ state: "active" });
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/agents?state=active");
  });
});
