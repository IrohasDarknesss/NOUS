import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../test/fetchMock";
import { getArchiveGenerations, getArchivePosts, listWorlds } from "./worlds";

describe("api/worlds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TC-NOUS72_DEV-06 listWorlds は GET /admin/api/worlds を呼ぶ", async () => {
    const mock = mockFetch({
      "GET /admin/api/worlds": { status: 200, body: { items: [] } },
    });

    const res = await listWorlds();
    expect(res).toEqual({ items: [] });
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/worlds");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("TC-NOUS72_DEV-07 getArchivePosts と getArchiveGenerations は worldId をエンコードし cursor・limit をクエリ文字列にして GET する", async () => {
    const mock = mockFetch({
      "GET /admin/api/worlds/world%2F1/posts": {
        status: 200,
        body: { items: [], nextCursor: null },
      },
      "GET /admin/api/worlds/world%2F1/generations": {
        status: 200,
        body: { items: [], nextCursor: null },
      },
    });

    await getArchivePosts("world/1", { cursor: "cur-p", limit: 30 });
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/worlds/world%2F1/posts?cursor=cur-p&limit=30");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("GET");

    await getArchiveGenerations("world/1", { cursor: undefined, limit: 50 });
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/worlds/world%2F1/generations?limit=50");
    expect(mock.mock.calls[1]?.[1]?.method).toBe("GET");
  });
});
