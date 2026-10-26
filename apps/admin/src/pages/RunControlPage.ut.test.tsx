// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_P202.json
import type { AuditLog, WorldState } from "@nous/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk, type MockResponse, type MockRoutes } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { buttonStates, type ControlAction } from "./runControl/ControlButtons";
import { RecentAuditTable } from "./runControl/RecentAuditTable";
import { usageLevel } from "./runControl/UsageCard";

afterEach(() => vi.unstubAllGlobals());

const auditEmpty: MockResponse = { status: 200, body: { items: [], nextCursor: null } };
const baseWorld = worldOk.body as Record<string, unknown>;

function worldIn(state: WorldState, extra: Record<string, unknown> = {}): MockResponse {
  return { status: 200, body: { ...baseWorld, state, ...extra } };
}

function errorOf(status: number, code: string, message = "server"): MockResponse {
  return { status, body: { error: { code, message } } };
}

async function openRunControl(world: MockResponse, routes: MockRoutes = {}) {
  const mock = mockFetch({
    "GET /admin/api/session": sessionOk,
    "GET /admin/api/world": world,
    "GET /admin/api/audit-logs": auditEmpty,
    ...routes,
  });
  const utils = renderApp("/");
  await screen.findByRole("region", { name: "実行制御の操作" });
  return { ...utils, mock };
}

function callsTo(mock: ReturnType<typeof mockFetch>, method: string, path: string): number {
  return mock.mock.calls.filter(
    ([url, init]) => String(url).split("?")[0] === path && (init?.method ?? "GET") === method,
  ).length;
}

const ENABLED: Record<WorldState, ControlAction[]> = {
  preparing: ["start"],
  running: ["pause", "emergency"],
  paused: ["resume", "emergency", "reset"],
  limit_stopped: ["pause", "emergency", "reset"],
  emergency_stopped: ["resume", "reset"],
  archived: [],
};
const ACTIONS: ControlAction[] = ["start", "pause", "resume", "emergency", "reset"];

describe("buttonStates・usageLevel（単体テスト）", () => {
  it.each(Object.entries(ENABLED) as Array<[WorldState, ControlAction[]]>)(
    "TC-UT_P202-001 状態ごとに、押せるボタンが FE 詳細設計 4章 buttonStates のとおりになる（%s）",
    (state, enabled) => {
      const states = buttonStates(state, 1);

      const actual = ACTIONS.filter((a) => states[a].enabled);

      expect(actual).toEqual(enabled);
      for (const a of ACTIONS) expect(states[a].reason === null).toBe(states[a].enabled);
    },
  );

  it.each([
    ["running", "start", "準備中の世界だけ開始できます"],
    ["preparing", "pause", "まだ開始していません"],
    ["paused", "pause", "すでに一時停止しています"],
    ["emergency_stopped", "pause", "緊急停止中です"],
    ["archived", "pause", "稼働・上限停止のときだけ一時停止できます"],
    ["preparing", "resume", "まだ開始していません"],
    ["running", "resume", "すでに稼働しています"],
    ["limit_stopped", "resume", "上限停止中です"],
    ["archived", "resume", "一時停止・緊急停止のときだけ再開できます"],
    ["preparing", "emergency", "まだ開始していません"],
    ["emergency_stopped", "emergency", "すでに緊急停止しています"],
    ["archived", "emergency", "現在は緊急停止できません"],
    ["archived", "reset", "一時停止・上限停止・緊急停止のときだけリセットできます"],
  ] as Array<[WorldState, ControlAction, string]>)(
    "TC-UT_P202-002 押せないボタンには、状態に応じた理由の文言を付ける（%s）",
    (state, action, reason) => {
      const states = buttonStates(state, 1);

      expect(states[action]).toEqual({ enabled: false, reason });
    },
  );

  it("TC-UT_P202-003 usageLevel は上限が 0 以下なら使用量に関係なく danger にする", () => {
    const zeroUsed = usageLevel(0, 0);
    const negativeLimit = usageLevel(10, -1);

    expect(zeroUsed).toBe("danger");
    expect(negativeLimit).toBe("danger");
  });
});

describe("P202 の操作（単体テスト）", () => {
  it("TC-UT_P202-004 開始は「世界を開始します。よろしいですか」の確認を出し、キャンセルなら送らず、確定で送って「開始しました」を出す", async () => {
    const { mock } = await openRunControl(worldIn("preparing"), {
      "POST /admin/api/world/start": { status: 200, body: { state: "running", startedAt: "2026-10-22T00:00:00.000Z" } },
    });

    await userEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(screen.getByText("世界を開始します。よろしいですか")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    const afterCancel = callsTo(mock, "POST", "/admin/api/world/start");
    await userEvent.click(screen.getByRole("button", { name: "開始" }));
    await userEvent.click(screen.getByRole("button", { name: "開始する" }));

    expect(afterCancel).toBe(0);
    expect(await screen.findByText("開始しました")).toBeInTheDocument();
    expect(callsTo(mock, "POST", "/admin/api/world/start")).toBe(1);
  });

  it("TC-UT_P202-005 一時停止からの再開は確認を出さずに送り、「再開しました」を出す", async () => {
    const { mock } = await openRunControl(worldIn("paused", { stopReason: "manual_pause" }), {
      "POST /admin/api/world/resume": { status: 200, body: { state: "running", stopReason: null } },
    });

    await userEvent.click(screen.getByRole("button", { name: "再開" }));

    expect(await screen.findByText("再開しました")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(mock, "POST", "/admin/api/world/resume")).toBe(1);
  });

  it("TC-UT_P202-006 緊急停止からの再開は「状況を確認しましたか」の確認を出し、確定するまで送らない", async () => {
    const { mock } = await openRunControl(worldIn("emergency_stopped", { stopReason: "emergency" }), {
      "POST /admin/api/world/resume": { status: 200, body: { state: "running", stopReason: null } },
    });

    await userEvent.click(screen.getByRole("button", { name: "再開" }));
    const beforeConfirm = callsTo(mock, "POST", "/admin/api/world/resume");
    expect(screen.getByText("状況を確認しましたか")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再開する" }));

    expect(beforeConfirm).toBe(0);
    await waitFor(() => expect(callsTo(mock, "POST", "/admin/api/world/resume")).toBe(1));
  });

  it("TC-UT_P202-007 操作が 409 STATE_CONFLICT なら P202 の文言を様式②に出し、世界の状態を取り直す", async () => {
    const { mock } = await openRunControl(worldOk, {
      "POST /admin/api/world/pause": errorOf(409, "STATE_CONFLICT"),
    });
    const before = callsTo(mock, "GET", "/admin/api/world");

    await userEvent.click(screen.getByRole("button", { name: "一時停止" }));

    expect(
      await screen.findByText("世界の状態が変わったため、操作できませんでした。最新の状態を表示します"),
    ).toBeInTheDocument();
    await waitFor(() => expect(callsTo(mock, "GET", "/admin/api/world")).toBeGreaterThan(before));
  });

  it("TC-UT_P202-008 開始が 409 NO_AGENTS なら P202 の文言を様式②に出し、エージェントの画面（P203）へのリンクを添える", async () => {
    await openRunControl(worldIn("preparing"), { "POST /admin/api/world/start": errorOf(409, "NO_AGENTS") });

    await userEvent.click(screen.getByRole("button", { name: "開始" }));
    await userEvent.click(screen.getByRole("button", { name: "開始する" }));

    const banner = await screen.findByText(/エージェントが登録されていません。先にエージェントを登録してください/);
    const alert = banner.closest('[role="alert"]') as HTMLElement;
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/agents");
  });

  it("TC-UT_P202-009 操作が 500 なら様式①「操作に失敗しました。状態を確かめてからやり直してください」を出す", async () => {
    await openRunControl(worldOk, { "POST /admin/api/world/pause": errorOf(500, "INTERNAL_ERROR") });

    await userEvent.click(screen.getByRole("button", { name: "一時停止" }));

    expect(await screen.findByText("操作に失敗しました。状態を確かめてからやり直してください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("TC-UT_P202-010 リセットがサーバーで 400 CONFIRM_MISMATCH なら、ダイアログを閉じずに入力欄の下へ文言を出す", async () => {
    await openRunControl(worldIn("paused", { stopReason: "manual_pause" }), {
      "POST /admin/api/world/reset": errorOf(400, "CONFIRM_MISMATCH", "世界の名前が一致しません"),
    });

    await userEvent.click(screen.getByRole("button", { name: "リセット" }));
    await userEvent.type(screen.getByLabelText("世界の名前"), "世界 2026-10-22");
    await userEvent.click(screen.getByRole("button", { name: "リセットする" }));

    expect(await screen.findByText("世界の名前が一致しません")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("TC-UT_P202-011 リセットが 409 GENERATION_RUNNING ならダイアログを閉じ、様式②に文言を出す", async () => {
    await openRunControl(worldIn("paused", { stopReason: "manual_pause" }), {
      "POST /admin/api/world/reset": errorOf(409, "GENERATION_RUNNING"),
    });

    await userEvent.click(screen.getByRole("button", { name: "リセット" }));
    await userEvent.type(screen.getByLabelText("世界の名前"), "世界 2026-10-22");
    await userEvent.click(screen.getByRole("button", { name: "リセットする" }));

    expect(await screen.findByText("実行中の生成があります。終わってから操作してください")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("TC-UT_P202-012 操作の送信中は、ほかの操作のボタンもすべて押せなくする", async () => {
    await openRunControl(worldOk);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    await userEvent.click(screen.getByRole("button", { name: "一時停止" }));

    const region = screen.getByRole("region", { name: "実行制御の操作" });
    for (const button of within(region).getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("TC-UT_P202-013 ページを開いたときに世界の状態の取得が 500 なら、様式①「状態を取得できませんでした」を出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": errorOf(500, "INTERNAL_ERROR"),
      "GET /admin/api/audit-logs": auditEmpty,
    });

    renderApp("/");

    expect(await screen.findByText("状態を取得できませんでした")).toBeInTheDocument();
  });
});

describe("P202 の表示（単体テスト）", () => {
  it.each([
    ["running", "2026-10-22T05:40:00.000Z", null, "14:40", "―"],
    ["paused", "2026-10-22T05:40:00.000Z", "manual_pause", "―", "一時停止"],
    ["running", null, null, "―", "―"],
  ] as const)(
    "TC-UT_P202-014 次の巡の予定は稼働のときだけ JST の HH:MM で出し、それ以外は「―」にする（%s）",
    async (state, nextCycleAt, stopReason, nextText, reasonText) => {
      await openRunControl(worldIn(state, { nextCycleAt, stopReason }));

      const card = screen.getByRole("region", { name: "世界の状態" });

      expect(within(card).getByText("次の巡の予定（JST）").nextElementSibling).toHaveTextContent(nextText);
      expect(within(card).getByText("停止理由").nextElementSibling).toHaveTextContent(reasonText);
      expect(within(card).getByText("稼働 9 体・停止 1 体")).toBeInTheDocument();
      expect(within(card).getByText("第 22 巡")).toBeInTheDocument();
    },
  );

  it("TC-UT_P202-015 利用量は上限の 80% 以上で黄、100% で赤にし、実行中の生成の数と概算費用 0 円を出す", async () => {
    await openRunControl(
      worldIn("running", {
        usage: {
          usageDate: "2026-10-22",
          neurons: 7600,
          neuronsLimit: 9500,
          runs: 480,
          runsLimit: 480,
          freeTierNeurons: 10000,
        },
        runningGenerations: 2,
      }),
    );

    const card = screen.getByRole("region", { name: "利用日の利用量" });

    expect(within(card).getByTestId("neurons-bar")).toHaveAttribute("data-level", "warning");
    expect(within(card).getByTestId("runs-bar")).toHaveAttribute("data-level", "danger");
    expect(within(card).getByText("実行中 2")).toBeInTheDocument();
    expect(within(card).getByText("概算費用：0 円")).toBeInTheDocument();
  });

  it("TC-UT_P202-016 最近の操作は操作の種類を日本語にし、時刻を JST、対象を「種類 (ID)」（ID がなければ種類だけ）で出し、0 件なら「操作履歴はありません」", () => {
    const item: AuditLog = {
      auditId: "01JAUDIT000000000000000001",
      operation: "world.emergency_stop",
      targetType: "world",
      targetId: "01JWORLD",
      beforeJson: null,
      afterJson: null,
      operatedAt: "2026-10-22T05:40:00.000Z",
    };

    const noTarget: AuditLog = {
      ...item,
      auditId: "01JAUDIT000000000000000002",
      operation: "admin.login",
      targetType: "admin",
      targetId: null,
    };
    const { rerender } = render(
      <MemoryRouter>
        <RecentAuditTable items={[item, noTarget]} />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole("row");
    const textsOf = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    const cells = textsOf(rows[1] as HTMLElement);
    const noTargetCells = textsOf(rows[2] as HTMLElement);
    rerender(
      <MemoryRouter>
        <RecentAuditTable items={[]} />
      </MemoryRouter>,
    );

    expect(cells[0]).toContain("14:40");
    expect(cells.slice(1)).toEqual(["緊急停止", "world (01JWORLD)"]);
    expect(noTargetCells.slice(1)).toEqual(["管理ログイン", "admin"]);
    expect(screen.getByText("操作履歴はありません")).toBeInTheDocument();
  });
});
