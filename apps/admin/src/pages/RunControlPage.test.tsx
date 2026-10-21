import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { buttonStates } from "./runControl/ControlButtons";
import { usageLevel } from "./runControl/UsageCard";

afterEach(() => vi.unstubAllGlobals());

const auditEmpty = {
  status: 200,
  body: { items: [], nextCursor: null },
};

describe("P202 RunControlPage", () => {
  it("TC-NOUS69_DEV-08 buttonStates は準備中（preparing）でリセットを無効にし理由を返し、体数 0 では開始も無効にする", () => {
    const withAgents = buttonStates("preparing", 3);
    expect(withAgents.start).toEqual({ enabled: true, reason: null });
    expect(withAgents.pause.enabled).toBe(false);
    expect(withAgents.resume.enabled).toBe(false);
    expect(withAgents.emergency.enabled).toBe(false);
    expect(withAgents.reset).toEqual({
      enabled: false,
      reason: "まだ開始していない世界はリセットできません",
    });

    const zeroAgents = buttonStates("preparing", 0);
    expect(zeroAgents.start.enabled).toBe(false);
    expect(zeroAgents.start.reason).toBe("エージェントが 0 体のため開始できません");
  });

  it("TC-NOUS69_DEV-09 buttonStates は稼働中でリセットを無効にし、一時停止・上限停止・緊急停止ではリセットを有効にする", () => {
    const running = buttonStates("running", 5);
    expect(running.pause.enabled).toBe(true);
    expect(running.emergency.enabled).toBe(true);
    expect(running.reset).toEqual({ enabled: false, reason: "先に一時停止してください" });

    expect(buttonStates("paused", 5).reset).toEqual({ enabled: true, reason: null });
    expect(buttonStates("limit_stopped", 5).reset).toEqual({ enabled: true, reason: null });
    expect(buttonStates("emergency_stopped", 5).reset).toEqual({ enabled: true, reason: null });
  });

  it("TC-NOUS69_DEV-10 usageLevel は比が 0.8 未満で normal、0.8 以上 1.0 未満で warning、1.0 以上で danger を返す", () => {
    expect(usageLevel(799, 1000)).toBe("normal");
    expect(usageLevel(800, 1000)).toBe("warning");
    expect(usageLevel(999, 1000)).toBe("warning");
    expect(usageLevel(1000, 1000)).toBe("danger");
    expect(usageLevel(1200, 1000)).toBe("danger");
  });

  it("TC-NOUS69_DEV-11 P202 準備中の画面ではリセットのボタンが disabled になり、下に押せない理由を表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": {
        status: 200,
        body: {
          ...(worldOk.body as object),
          state: "preparing",
          agentCounts: { active: 0, stopped: 0 },
        },
      },
      "GET /admin/api/audit-logs": auditEmpty,
    });
    renderApp("/");

    const resetBtn = await screen.findByRole("button", { name: "リセット" });
    expect(resetBtn).toBeDisabled();
    expect(screen.getByText("まだ開始していない世界はリセットできません")).toBeInTheDocument();

    const startBtn = screen.getByRole("button", { name: "開始" });
    expect(startBtn).toBeDisabled();
    expect(screen.getByText("エージェントが 0 体のため開始できません")).toBeInTheDocument();
  });

  it("TC-NOUS69_DEV-12 P202 一時停止は確認ダイアログなしで POST /admin/api/world/pause を送りトーストを表示する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/audit-logs": auditEmpty,
      "POST /admin/api/world/pause": {
        status: 200,
        body: { state: "paused", worldTimeSec: 7260, runningGenerations: 1 },
      },
    });
    renderApp("/");

    const pauseBtn = await screen.findByRole("button", { name: "一時停止" });
    await userEvent.click(pauseBtn);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "一時停止しました。実行中の生成は最大 60 秒で終わります",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/admin/api/world/pause")).toBe(true);
  });

  it("TC-NOUS69_DEV-13 P202 緊急停止は確認ダイアログを経て POST /admin/api/world/emergency-stop を送りトーストを表示する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/audit-logs": auditEmpty,
      "POST /admin/api/world/emergency-stop": {
        status: 200,
        body: { state: "emergency_stopped", cancelledGenerations: 2 },
      },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "緊急停止" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("実行中の生成を取り消して止めます");

    await userEvent.click(within(dialog).getByRole("button", { name: "緊急停止する" }));

    expect(await screen.findByRole("status")).toHaveTextContent("緊急停止しました。取り消した生成 2 件");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/admin/api/world/emergency-stop")).toBe(true);
  });

  it("TC-NOUS69_DEV-14 P202 リセットのダイアログで世界の名前が一致しないときは「世界の名前が一致しません」を表示し送信しない", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": {
        status: 200,
        body: { ...(worldOk.body as object), state: "paused" },
      },
      "GET /admin/api/audit-logs": auditEmpty,
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "リセット" }));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("世界の名前");
    await userEvent.type(input, "違う世界名");
    await userEvent.click(within(dialog).getByRole("button", { name: "リセットする" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("世界の名前が一致しません");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/admin/api/world/reset")).toBe(false);
  });

  it("TC-NOUS69_DEV-15 P202 リセットのダイアログで世界の名前が一致したときは POST /admin/api/world/reset を送りトーストを表示する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": {
        status: 200,
        body: { ...(worldOk.body as object), state: "paused" },
      },
      "GET /admin/api/audit-logs": auditEmpty,
      "POST /admin/api/world/reset": {
        status: 200,
        body: {
          archivedWorldId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
          newWorldId: "01JABCDEFGHJKMNPQRSTVWXYZ1",
          state: "preparing",
        },
      },
    });
    renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: "リセット" }));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("世界の名前");
    await userEvent.type(input, "世界 2026-10-22");
    await userEvent.click(within(dialog).getByRole("button", { name: "リセットする" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("リセットしました。前の世界はアーカイブにあります"),
    );
    const resetCall = fetchMock.mock.calls.find(([url]) => String(url) === "/admin/api/world/reset");
    expect(resetCall?.[1]?.body).toBe(JSON.stringify({ confirmName: "世界 2026-10-22" }));
  });
});
