import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson, navigation, NetworkError, NotInvitedError } from "./client";

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchJson", () => {
  it("TC-NOUS49_DEV-01 2xx なら JSON を返し、Cookie を同じオリジンで送る", async () => {
    const fetchMock = respond(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("/api/world")).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/world", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("TC-NOUS49_DEV-02 401 なら /not-invited へ移して NotInvitedError を投げる", async () => {
    vi.stubGlobal("fetch", respond(401, { error: { code: "VIEW_NOT_INVITED", message: "x" } }));
    const toNotInvited = vi.spyOn(navigation, "toNotInvited").mockImplementation(() => {});
    await expect(fetchJson("/api/timeline")).rejects.toBeInstanceOf(NotInvitedError);
    expect(toNotInvited).toHaveBeenCalledTimes(1);
  });

  it("TC-NOUS49_DEV-03 2xx 以外は本文の error を ApiError にする", async () => {
    vi.stubGlobal("fetch", respond(404, { error: { code: "POST_NOT_FOUND", message: "not found" } }));
    const err = await fetchJson("/api/posts/x/thread").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "POST_NOT_FOUND", message: "not found" });
  });

  it("TC-NOUS49_DEV-04 本文が JSON でない失敗は code を null にする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(fetchJson("/api/world")).rejects.toMatchObject({ status: 500, code: null });
  });

  it("TC-NOUS49_DEV-05 通信できなければ NetworkError を投げる", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchJson("/api/world")).rejects.toBeInstanceOf(NetworkError);
  });
});
