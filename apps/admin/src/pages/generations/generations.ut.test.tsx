// 単体テスト（NOUS-107）。観点表は docs/test/unit/NOUS-107/観点表_P207.json・観点表_P208.json
import type {
  AgentListResponse,
  GenerationAttempt,
  GenerationDetail,
  GenerationEventDetail,
  GenerationItem,
  GenerationPage,
} from "@nous/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk, type MockResponse } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { GENERATION_DETAIL_ERROR_MESSAGE } from "../GenerationDetailPage";
import { GENERATIONS_ERROR_MESSAGE, buildGenerationSearchParams, parseGenerationFilters } from "../GenerationListPage";
import { AttemptTable } from "./AttemptTable";
import { ConsistencyFlags, describeFlag } from "./ConsistencyFlags";
import { COPY_FEEDBACK_MS, copyEventId, formatDateTimeJst } from "./EventSummary";
import {
  GenerationFilters,
  searchByEventId,
  toLocalDateTime,
  toUtcIso,
  validateGenerationRange,
} from "./GenerationFilters";
import { GenerationTable, formatStartedTimeJst } from "./GenerationTable";
import { InputSection } from "./InputSection";
import { PromptViewer } from "./PromptViewer";
import { ResultPostCard, buildModerationPath } from "./ResultPostCard";
import { FAILURE_KIND_LABELS, StatusBadge, formatFailureKind } from "./StatusBadge";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const EVENT_ID = "01JABCDEFGHJKMNPQRSTVWXYZ2";
const SESSION_EXPIRED = "ログインの有効期限が切れました。もう一度ログインしてください";
const SERVER_ERROR: MockResponse = { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } };
const UNAUTHORIZED: MockResponse = { status: 401, body: { error: { code: "ADMIN_UNAUTHORIZED", message: "x" } } };

const agentsBody: AgentListResponse = {
  items: [
    {
      agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1",
      handle: "minato",
      displayName: "ミナト",
      state: "active",
      activityLevel: 3,
      postCount: 10,
      lastActionAt: "2026-10-22T05:20:00.000Z",
      lastAction: "post",
    },
  ],
  worldState: "running",
};

function genItem(overrides: Partial<GenerationItem> = {}): GenerationItem {
  return {
    eventId: EVENT_ID,
    startedAt: "2026-10-22T05:20:00.000Z",
    worldTimeSec: 7200,
    agent: { agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1", displayName: "ミナト" },
    action: "post",
    decidedBy: "llm",
    status: "succeeded",
    failureKind: null,
    neurons: 15.2,
    attemptCount: 1,
    hasConsistencyFlags: false,
    ...overrides,
  };
}

function eventDetail(overrides: Partial<GenerationEventDetail> = {}): GenerationEventDetail {
  return {
    eventId: EVENT_ID,
    worldId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
    agent: { agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1", displayName: "ミナト", handle: "minato" },
    cycleNo: 22,
    cycleSeed: 834201,
    status: "succeeded",
    decidedBy: "llm",
    action: "post",
    failureKind: null,
    actionCandidates: ["post", "like"],
    inputAttributes: { interests: "都市観察" },
    inputMemories: [{ kind: "interest_profile", content: "興味：都市観察" }],
    inputPostIds: [],
    promptText: "SYSTEM: あなたはミナトです",
    outputText: '{"action":"post"}',
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    promptVersion: "v1",
    llmMode: "cloudflare",
    promptTokens: 1480,
    completionTokens: 72,
    neurons: 15.2,
    costJpy: 0,
    consistencyFlags: null,
    worldTimeSec: 7200,
    startedAt: "2026-10-22T05:20:00.000Z",
    finishedAt: "2026-10-22T05:20:02.000Z",
    ...overrides,
  };
}

function attempt(overrides: Partial<GenerationAttempt> = {}): GenerationAttempt {
  return {
    attemptNo: 1,
    result: "ok",
    httpStatus: 200,
    errorDetail: null,
    promptTokens: 1480,
    completionTokens: 72,
    neurons: 15.2,
    durationMs: 1930,
    ...overrides,
  };
}

function detail(overrides: Partial<GenerationDetail> = {}): GenerationDetail {
  return { event: eventDetail(), attempts: [attempt()], refPosts: [], resultPost: null, ...overrides };
}

function generationCalls(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((u) => u === "/admin/api/generations" || u.startsWith("/admin/api/generations?"));
}

/** 表の本文の行（見出しの行を除く） */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("P207 生成ログ一覧（単体テスト）", () => {
  it("TC-UT_P207-001 URL の知らない行動・状態と、空の値は絞り込みに入れない", () => {
    const filters = parseGenerationFilters(new URLSearchParams("action=repost&status=done&agentId=&from=&to="));

    expect(filters).toEqual({});
  });

  it("TC-UT_P207-002 絞り込みは値のある項目だけを URL に入れ、URL から読み直すと同じ絞り込みになる", () => {
    const filters = {
      agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1",
      status: "failed" as const,
      from: "2026-10-22T00:00:00.000Z",
    };

    const params = buildGenerationSearchParams(filters);

    expect([...params.keys()]).toEqual(["agentId", "status", "from"]);
    expect(parseGenerationFilters(params)).toEqual(filters);
  });

  it("TC-UT_P207-003 toUtcIso は秒まである JST の入力も UTC に変える", () => {
    expect(toUtcIso("2026-10-22T14:20:30")).toBe("2026-10-22T05:20:30.000Z");
  });

  it("TC-UT_P207-004 toUtcIso は Z や +09:00 の付いた値をその時刻のまま扱い、読めない値は空にする", () => {
    expect(toUtcIso("2026-10-22T05:20:00Z")).toBe("2026-10-22T05:20:00.000Z");
    expect(toUtcIso("2026-10-22T14:20:00+09:00")).toBe("2026-10-22T05:20:00.000Z");
    expect(toUtcIso("abc")).toBe("");
  });

  it("TC-UT_P207-005 JST の 8:59 は UTC の前の日、9:00 は同じ日の 00:00 になる", () => {
    expect(toUtcIso("2026-10-22T08:59")).toBe("2026-10-21T23:59:00.000Z");
    expect(toUtcIso("2026-10-22T09:00")).toBe("2026-10-22T00:00:00.000Z");
  });

  it("TC-UT_P207-006 toLocalDateTime は UTC の 15:00 を JST の翌日 00:00 にし、読めない値は空にする", () => {
    expect(toLocalDateTime("2026-10-21T15:00:00.000Z")).toBe("2026-10-22T00:00");
    expect(toLocalDateTime("not-a-date")).toBe("");
  });

  it("TC-UT_P207-007 期間は開始と終了が同じ時刻なら通し、開始が後なら文言を返し、片方だけなら通す", () => {
    expect(validateGenerationRange("2026-10-22T00:00:00.000Z", "2026-10-22T00:00:00.000Z")).toBeNull();
    expect(validateGenerationRange("2026-10-22T00:00:01.000Z", "2026-10-22T00:00:00.000Z")).toBe(
      "開始は終了より前にしてください",
    );
    expect(validateGenerationRange("2026-10-22T00:00:00.000Z", undefined)).toBeNull();
  });

  it("TC-UT_P207-008 実行 ID は前後の空白を除いて検索し、25 字・27 字は文言を返す", () => {
    const navigate = vi.fn();

    expect(searchByEventId(`  ${EVENT_ID}  `, navigate)).toBeNull();
    expect(navigate).toHaveBeenCalledWith(`/generations/${EVENT_ID}`);
    expect(searchByEventId(EVENT_ID.slice(0, 25), vi.fn())).toBe("実行 ID は 26 字です");
    expect(searchByEventId(`${EVENT_ID}A`, vi.fn())).toBe("実行 ID は 26 字です");
  });

  it("TC-UT_P207-009 実行 ID の英小文字は受け付けない", () => {
    const navigate = vi.fn();

    expect(searchByEventId(EVENT_ID.toLowerCase(), navigate)).toBe("実行 ID は 26 字です");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("TC-UT_P207-010 期間の開始を終了より後にすると、入力欄の下に文言を出し、絞り込みを変えない", () => {
    const onChange = vi.fn();
    render(<GenerationFilters filters={{}} agents={[]} onChange={onChange} onSearchId={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "2026-10-22T15:00" } });
    fireEvent.change(screen.getByLabelText("期間の終了"), { target: { value: "2026-10-22T14:00" } });

    expect(screen.getByText("開始は終了より前にしてください")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-22T06:00:00.000Z", to: undefined });
  });

  it("TC-UT_P207-011 期間を入れると、ほかの絞り込みを残したまま、UTC の ISO 8601 で絞り込みを変える", () => {
    const onChange = vi.fn();
    render(<GenerationFilters filters={{ status: "failed" }} agents={[]} onChange={onChange} onSearchId={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "2026-10-22T09:00" } });

    expect(onChange).toHaveBeenCalledWith({ status: "failed", from: "2026-10-22T00:00:00.000Z", to: undefined });
  });

  it("TC-UT_P207-012 実行 ID が誤っていれば文言を出し、入力を直すと文言を消す", async () => {
    const navigate = vi.fn();
    render(
      <GenerationFilters
        filters={{}}
        agents={[]}
        onChange={vi.fn()}
        onSearchId={(input) => searchByEventId(input, navigate)}
      />,
    );
    const input = screen.getByPlaceholderText("26 字の ULID");

    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    expect(screen.getByText("実行 ID は 26 字です")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(input, "d");

    expect(screen.queryByText("実行 ID は 26 字です")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("TC-UT_P207-013 「クリア」は絞り込みがあるときだけ出し、押すと絞り込みを空にする", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <GenerationFilters filters={{}} agents={[]} onChange={onChange} onSearchId={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "クリア" })).toBeNull();

    rerender(<GenerationFilters filters={{ action: "post" }} agents={[]} onChange={onChange} onSearchId={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "クリア" }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it("TC-UT_P207-014 エージェントの選択肢は「すべて」と各エージェントの表示名で、「すべて」を選ぶと絞り込みを外す", async () => {
    const onChange = vi.fn();
    const agents = [{ agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1", displayName: "ミナト" }];
    const { rerender } = render(
      <GenerationFilters filters={{}} agents={agents} onChange={onChange} onSearchId={vi.fn()} />,
    );
    const select = screen.getByLabelText("エージェント");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["すべて", "ミナト"]);

    await userEvent.selectOptions(select, "01JABCDEFGHJKMNPQRSTVWXYZ1");
    expect(onChange).toHaveBeenLastCalledWith({ agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1" });

    rerender(
      <GenerationFilters
        filters={{ agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1" }}
        agents={agents}
        onChange={onChange}
        onSearchId={vi.fn()}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("エージェント"), "");

    expect(onChange).toHaveBeenLastCalledWith({ agentId: undefined });
  });

  it("TC-UT_P207-015 参加しない（gate）の行は決め方を「参加しない」、Neurons を 0 と出し、LLM の行は小数 1 桁で出す", () => {
    render(
      <GenerationTable
        items={[
          genItem({ eventId: "E1", decidedBy: "gate", action: "none", neurons: 0, attemptCount: 0 }),
          genItem({ eventId: "E2", decidedBy: "llm", neurons: 15.24 }),
        ]}
        onRowClick={vi.fn()}
      />,
    );

    const [gateRow, llmRow] = bodyRows();
    expect(within(gateRow!).getByText("参加しない")).toBeInTheDocument();
    expect(within(gateRow!).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(llmRow!).getByText("LLM")).toBeInTheDocument();
    expect(within(llmRow!).getByText("15.2")).toBeInTheDocument();
  });

  it("TC-UT_P207-016 不正な形式で失敗した行も、Neurons と試行の回数をそのまま出す", () => {
    render(
      <GenerationTable
        items={[
          genItem({ status: "failed", failureKind: "invalid_format", action: null, neurons: 31, attemptCount: 2 }),
        ]}
        onRowClick={vi.fn()}
      />,
    );

    const [row] = bodyRows();
    expect(within(row!).getByText("31.0")).toBeInTheDocument();
    expect(within(row!).getByText("2")).toBeInTheDocument();
    expect(within(row!).getByText("不正な形式")).toBeInTheDocument();
    expect(within(row!).getByText("失敗（不正な形式）")).toBeInTheDocument();
  });

  it("TC-UT_P207-017 失敗の行の行動は、action の値があっても「―」と出す", () => {
    render(
      <GenerationTable
        items={[genItem({ status: "failed", failureKind: "server_error", action: "post" })]}
        onRowClick={vi.fn()}
      />,
    );

    const [row] = bodyRows();
    expect(within(row!).queryByText("post")).toBeNull();
  });

  it("TC-UT_P207-018 失敗の種類は失敗・取り消し・中断の行だけに出し、成功の行は「―」", () => {
    render(
      <GenerationTable
        items={[
          genItem({ eventId: "E1", status: "succeeded", failureKind: null }),
          genItem({ eventId: "E2", status: "cancelled", failureKind: "stopped", action: null }),
        ]}
        onRowClick={vi.fn()}
      />,
    );

    const [ok, cancelled] = bodyRows();
    expect(within(ok!).queryByText("停止")).toBeNull();
    expect(within(cancelled!).getByText("停止")).toBeInTheDocument();
    expect(within(cancelled!).getByText("取り消し（停止）")).toBeInTheDocument();
  });

  it("TC-UT_P207-019 矛盾の候補は、あれば「あり」、なければ「―」", () => {
    render(
      <GenerationTable
        items={[genItem({ eventId: "E1", hasConsistencyFlags: true }), genItem({ eventId: "E2" })]}
        onRowClick={vi.fn()}
      />,
    );

    const [withFlags, withoutFlags] = bodyRows();
    expect(within(withFlags!).getByText("あり")).toBeInTheDocument();
    expect(within(withoutFlags!).queryByText("あり")).toBeNull();
  });

  it("TC-UT_P207-020 開始時刻は JST の HH:MM:SS で出し、日をまたぐと 00:00:00 になり、読めない値はそのまま出す", () => {
    expect(formatStartedTimeJst("2026-10-22T15:00:00.000Z")).toBe("00:00:00");
    expect(formatStartedTimeJst("2026-10-22T14:59:59.000Z")).toBe("23:59:59");
    expect(formatStartedTimeJst("x")).toBe("x");
  });

  it("TC-UT_P207-021 一覧が 0 件なら「条件に一致する生成イベントはありません」を出す", () => {
    render(<GenerationTable items={[]} onRowClick={vi.fn()} />);

    expect(screen.getByText("条件に一致する生成イベントはありません")).toBeInTheDocument();
  });

  it("TC-UT_P207-022 失敗の種類の 8 つを日本語にし、無いときは「―」にする", () => {
    expect(
      Object.keys(FAILURE_KIND_LABELS).map((k) => formatFailureKind(k as keyof typeof FAILURE_KIND_LABELS)),
    ).toEqual(["タイムアウト", "レート制限", "サーバーのエラー", "不正な形式", "無料枠", "取り消し", "停止", "中断"]);
    expect(formatFailureKind(null)).toBe("―");
    expect(formatFailureKind(undefined)).toBe("―");
  });

  it("TC-UT_P207-023 状態のバッジは、失敗でも種類が無ければ状態だけを出し、成功には種類を付けない", () => {
    const { rerender } = render(<StatusBadge status="failed" failureKind={null} />);
    expect(screen.getByText("失敗")).toBeInTheDocument();

    rerender(<StatusBadge status="succeeded" failureKind="timeout" />);

    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.queryByText(/タイムアウト/)).toBeNull();
  });

  it("TC-UT_P207-024 URL の絞り込みをそのまま一覧の API に渡し、期間は JST で入力欄に出す", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/generations": { status: 200, body: { items: [], nextCursor: null } },
    });
    const query =
      "agentId=01JABCDEFGHJKMNPQRSTVWXYZ1&action=post&status=failed&from=2026-10-22T00%3A00%3A00.000Z&to=2026-10-23T00%3A00%3A00.000Z";

    renderApp(`/generations?${query}`);

    await waitFor(() => expect(generationCalls(fetchMock).length).toBeGreaterThan(0));
    expect(generationCalls(fetchMock)[0]).toBe(`/admin/api/generations?${query}`);
    expect(screen.getByLabelText("期間の開始")).toHaveValue("2026-10-22T09:00");
    expect(screen.getByLabelText("期間の終了")).toHaveValue("2026-10-23T09:00");
  });

  it("TC-UT_P207-025 続きがあれば「さらに読み込む」を出し、押すと cursor を付けて取得して末尾に足し、続きが無くなれば消す", async () => {
    const pages: GenerationPage[] = [
      { items: [genItem({ eventId: "01JABCDEFGHJKMNPQRSTVWXY01" })], nextCursor: "cursor-1" },
      {
        items: [genItem({ eventId: "01JABCDEFGHJKMNPQRSTVWXY02", agent: { agentId: "A2", displayName: "ハルカ" } })],
        nextCursor: null,
      },
    ];
    let call = 0;
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/generations": () => ({ status: 200, body: pages[Math.min(call++, 1)] }),
    });
    renderApp("/generations");
    expect(await screen.findByRole("cell", { name: "ミナト" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "さらに読み込む" }));

    expect(await screen.findByRole("cell", { name: "ハルカ" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "ミナト" })).toBeInTheDocument();
    expect(generationCalls(fetchMock).at(-1)).toBe("/admin/api/generations?cursor=cursor-1");
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  });

  it("TC-UT_P207-026 一覧の取得が 500 なら「生成ログを取得できませんでした」をポップアップで出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/generations": SERVER_ERROR,
    });

    renderApp("/generations");

    expect(await screen.findByText(GENERATIONS_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it("TC-UT_P207-027 一覧の取得が 401 ならセッション切れのポップアップを出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/generations": UNAUTHORIZED,
    });

    renderApp("/generations");

    expect(await screen.findByText(SESSION_EXPIRED)).toBeInTheDocument();
    expect(screen.queryByText(GENERATIONS_ERROR_MESSAGE)).toBeNull();
  });

  it("TC-UT_P207-028 一覧の画面で正しい実行 ID を入れて検索すると、P208 を開く", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/generations": { status: 200, body: { items: [], nextCursor: null } },
      [`GET /admin/api/generations/${EVENT_ID}`]: { status: 200, body: detail() },
    });
    const { router } = renderApp("/generations");
    await screen.findByText("条件に一致する生成イベントはありません");

    await userEvent.type(screen.getByPlaceholderText("26 字の ULID"), `${EVENT_ID}{Enter}`);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/generations/${EVENT_ID}`));
  });

  it("TC-UT_P207-029 エージェントの選択肢の取得に失敗しても、一覧と「すべて」だけの選択肢を出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": SERVER_ERROR,
      "GET /admin/api/generations": { status: 200, body: { items: [genItem()], nextCursor: null } },
    });

    renderApp("/generations");

    expect(await screen.findByRole("cell", { name: "ミナト" })).toBeInTheDocument();
    const select = screen.getByLabelText("エージェント");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["すべて"]);
  });
});

describe("P208 生成ログ詳細（単体テスト）", () => {
  function mockDetail(response: MockResponse) {
    return mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      [`GET /admin/api/generations/${EVENT_ID}`]: response,
    });
  }

  it("TC-UT_P208-001 日時は JST の「YYYY-MM-DD HH:MM:SS」で出し、無いときは「―」、読めない値はそのまま出す", () => {
    expect(formatDateTimeJst("2026-10-22T15:00:00.000Z")).toBe("2026-10-23 00:00:00");
    expect(formatDateTimeJst(null)).toBe("―");
    expect(formatDateTimeJst("x")).toBe("x");
  });

  it("TC-UT_P208-002 クリップボードが使えれば実行 ID を写して true を返す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const ok = await copyEventId(EVENT_ID);

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(EVENT_ID);
  });

  it("TC-UT_P208-003 クリップボードへの書き込みが失敗したら、実行 ID の要素を選択状態にして false を返す", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = document.createElement("code");
    el.textContent = EVENT_ID;
    document.body.appendChild(el);

    const ok = await copyEventId(EVENT_ID, el);

    expect(ok).toBe(false);
    expect(window.getSelection()?.rangeCount).toBe(1);
    el.remove();
  });

  it("TC-UT_P208-004 クリップボードも選択する要素も無ければ、例外にせず false を返す", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    await expect(copyEventId(EVENT_ID, null)).resolves.toBe(false);
  });

  it("TC-UT_P208-005 「コピー」を押すと「コピー済み」と「コピーしました」を出し、2 秒後に「コピー」に戻す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockDetail({ status: 200, body: detail() });
    renderApp(`/generations/${EVENT_ID}`);
    await screen.findByTestId("event-id");

    await userEvent.click(screen.getByRole("button", { name: "コピー" }));
    expect(await screen.findByRole("button", { name: "コピー済み" })).toBeInTheDocument();
    expect(await screen.findByText("コピーしました")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });

    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
  });

  it("TC-UT_P208-006 概要に @ハンドル・巡と種・モデルと版・利用量（3 桁区切りと小数 1 桁、0 円）・時刻を出し、終了が無ければ「―」", async () => {
    mockDetail({
      status: 200,
      body: detail({
        event: eventDetail({
          status: "failed",
          failureKind: "invalid_format",
          action: null,
          neurons: 31,
          promptTokens: 2960,
          finishedAt: null,
        }),
      }),
    });

    renderApp(`/generations/${EVENT_ID}`);

    const summary = await screen.findByRole("region", { name: "概要" });
    expect(within(summary).getByText("@minato")).toBeInTheDocument();
    expect(within(summary).getByText("巡 22 ／ 種 834201")).toBeInTheDocument();
    expect(within(summary).getByText("@cf/google/gemma-4-26b-a4b-it ／ 版 v1（cloudflare）")).toBeInTheDocument();
    expect(
      within(summary).getByText(/入力 2,960 ／ 出力 72 トークン ・ 31\.0 Neurons ・ 概算費用 0 円/),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/終了 ―/)).toBeInTheDocument();
    expect(within(summary).getByText("失敗（不正な形式）")).toBeInTheDocument();
  });

  it("TC-UT_P208-007 参加しない（gate）の生成イベントは、行動・モデル・版を「―」、決め方を「参加しない」と出す", async () => {
    mockDetail({
      status: 200,
      body: detail({
        event: eventDetail({
          decidedBy: "gate",
          action: null,
          modelId: null,
          promptVersion: null,
          llmMode: "fixed",
          actionCandidates: null,
          promptText: null,
          outputText: null,
        }),
        attempts: [],
      }),
    });

    renderApp(`/generations/${EVENT_ID}`);

    const summary = await screen.findByRole("region", { name: "概要" });
    expect(within(summary).getByText("行動：― ／ 決め方：参加しない ／ 失敗の種類：―")).toBeInTheDocument();
    expect(within(summary).getByText("― ／ 版 ―（fixed）")).toBeInTheDocument();
  });

  it("TC-UT_P208-008 入力に用いた属性は、サーバーが送る項目名（display_name・values_text・activity_level）も日本語の項目名で出す", () => {
    render(
      <InputSection
        event={eventDetail({
          inputAttributes: { display_name: "ミナト", values_text: "誠実", activity_level: 3, interests: "散歩" },
        })}
        refPosts={[]}
      />,
    );

    expect(screen.getByText("表示名")).toBeInTheDocument();
    expect(screen.getByText("価値観")).toBeInTheDocument();
    expect(screen.getByText("活動頻度")).toBeInTheDocument();
    expect(screen.getByText("興味")).toBeInTheDocument();
    expect(screen.queryByText("display_name")).toBeNull();
  });

  it("TC-UT_P208-009 参加しない（gate）の生成イベントは、行動の候補・記憶・参照した投稿を出さない", () => {
    render(<InputSection event={eventDetail({ decidedBy: "gate", actionCandidates: null })} refPosts={[]} />);

    expect(screen.getByText("入力に用いた属性")).toBeInTheDocument();
    expect(screen.queryByText("入力に用いた記憶")).toBeNull();
    expect(screen.queryByText("参照した投稿")).toBeNull();
    expect(screen.queryByText("行動の候補")).toBeNull();
  });

  it("TC-UT_P208-010 記憶は kind・type・番号の順で種類を決め、content・text・summary の順で内容を出す", () => {
    render(
      <InputSection
        event={eventDetail({
          inputMemories: [
            { kind: "recent_posts", content: "内容A" },
            { type: "custom", text: "内容B" },
            "内容C",
            { summary: "内容D" },
          ],
        })}
        refPosts={[]}
      />,
    );

    const memory = screen.getByText("入力に用いた記憶").parentElement!;
    const rows = within(memory).getAllByRole("row").slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ["最近の自分の投稿", "内容A"],
      ["custom", "内容B"],
      ["#3", "内容C"],
      ["#4", "内容D"],
    ]);
  });

  it("TC-UT_P208-011 LLM の生成で記憶・参照した投稿・候補が無ければ、それぞれ「ありません」「なし」と出す", () => {
    render(<InputSection event={eventDetail({ inputMemories: [], actionCandidates: [] })} refPosts={[]} />);

    expect(screen.getByText("記憶はありません")).toBeInTheDocument();
    expect(screen.getByText("参照した投稿はありません")).toBeInTheDocument();
    expect(screen.getByText("なし")).toBeInTheDocument();
  });

  it("TC-UT_P208-012 入力の全文が無ければ開閉のボタンを出さず「なし（LLM を呼んでいません）」、出力が無ければ「なし」", () => {
    render(<PromptViewer promptText={null} outputText={null} />);

    expect(screen.getByText("なし（LLM を呼んでいません）")).toBeInTheDocument();
    expect(screen.getByText("なし")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("TC-UT_P208-013 折りたたみ中は字数をコードポイントで出し、ボタンを 2 回押すと閉じる", async () => {
    render(<PromptViewer promptText="𠮷あa" outputText="x" />);
    expect(screen.getByText("折りたたんでいます（3 字）")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "入力の全文を開く" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(button);
    expect(screen.getByTestId("prompt-text")).toHaveTextContent("𠮷あa");
    expect(screen.getByRole("button", { name: "入力の全文を閉じる" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "入力の全文を閉じる" }));

    expect(screen.queryByTestId("prompt-text")).toBeNull();
  });

  it("TC-UT_P208-014 入力・出力の全文に HTML があっても、文字のまま出して要素にしない", async () => {
    const { container } = render(<PromptViewer promptText="<i>入力</i>" outputText="<b>太字</b>" />);

    await userEvent.click(screen.getByRole("button", { name: "入力の全文を開く" }));

    expect(screen.getByTestId("output-text").textContent).toBe("<b>太字</b>");
    expect(screen.getByTestId("prompt-text").textContent).toBe("<i>入力</i>");
    expect(container.querySelector("b, i")).toBeNull();
  });

  it("TC-UT_P208-015 試行の表は、不正な形式の試行にも Neurons を出し、HTTP とエラーの内容が無ければ「―」", () => {
    render(
      <AttemptTable
        attempts={[
          attempt({
            attemptNo: 1,
            result: "invalid_format",
            errorDetail: "JSON がありません",
            neurons: 15.5,
            durationMs: 12345,
          }),
          attempt({ attemptNo: 2, result: "timeout", httpStatus: null, errorDetail: null, neurons: 0 }),
        ]}
      />,
    );

    const [first, second] = bodyRows();
    expect(within(first!).getByText("不正な形式")).toBeInTheDocument();
    expect(within(first!).getByText("15.5")).toBeInTheDocument();
    expect(within(first!).getByText("12,345 ms")).toBeInTheDocument();
    expect(within(second!).getByText("タイムアウト")).toBeInTheDocument();
    expect(within(second!).getAllByText("―")).toHaveLength(2);
  });

  it("TC-UT_P208-016 試行が無ければ「試行はありません」を出す", () => {
    render(<AttemptTable attempts={[]} />);

    expect(screen.getByText("試行はありません")).toBeInTheDocument();
  });

  it("TC-UT_P208-017 矛盾の候補が null・0 件なら「なし」、内容が空なら括弧を付けない", () => {
    const { rerender } = render(<ConsistencyFlags flags={null} />);
    expect(screen.getByText("なし")).toBeInTheDocument();
    rerender(<ConsistencyFlags flags={[]} />);
    expect(screen.getByText("なし")).toBeInTheDocument();

    rerender(<ConsistencyFlags flags={[{ code: "C02", detail: "" }]} />);

    expect(screen.getByText("C02：過去の発言の繰り返し")).toBeInTheDocument();
    expect(screen.queryByText(/（/)).toBeNull();
  });

  it("TC-UT_P208-018 知らないコードは、そのままのコードを説明として返す", () => {
    expect(describeFlag("C99" as Parameters<typeof describeFlag>[0])).toBe("C99");
  });

  it("TC-UT_P208-019 生成された投稿が無ければ「なし」、非表示の投稿は「非表示」と出し、本文の HTML は文字のまま出す", () => {
    const { rerender, container } = render(
      <MemoryRouter>
        <ResultPostCard post={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText("なし")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ResultPostCard post={{ postId: "P1", body: "<b>本文</b>", visibility: "hidden" }} />
      </MemoryRouter>,
    );

    expect(screen.getByText("非表示")).toBeInTheDocument();
    expect(screen.getByTestId("result-post-body").textContent).toBe("<b>本文</b>");
    expect(container.querySelector("[data-testid='result-post-body'] b")).toBeNull();
  });

  it("TC-UT_P208-020 非表示管理への URL は、投稿 ID を URL に使える形にして付ける", () => {
    expect(buildModerationPath("a b/c")).toBe("/moderation?postId=a%20b%2Fc");
  });

  it("TC-UT_P208-021 詳細の取得が 500 なら「生成ログを取得できませんでした」をポップアップで出す", async () => {
    mockDetail(SERVER_ERROR);

    renderApp(`/generations/${EVENT_ID}`);

    expect(await screen.findByText(GENERATION_DETAIL_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("生成イベントが見つかりません")).toBeNull();
  });

  it("TC-UT_P208-022 詳細の取得が 401 ならセッション切れのポップアップを出す", async () => {
    mockDetail(UNAUTHORIZED);

    renderApp(`/generations/${EVENT_ID}`);

    expect(await screen.findByText(SESSION_EXPIRED)).toBeInTheDocument();
  });

  it("TC-UT_P208-023 404 なら、コードが EVENT_NOT_FOUND でなくても「生成イベントが見つかりません」を出し、ポップアップは出さない", async () => {
    mockDetail({ status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } });

    renderApp(`/generations/${EVENT_ID}`);

    expect(await screen.findByText("生成イベントが見つかりません")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("TC-UT_P208-024 クリップボードに写せなかったときは「コピー済み」にするが、「コピーしました」は出さない", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockDetail({ status: 200, body: detail() });
    renderApp(`/generations/${EVENT_ID}`);
    await screen.findByTestId("event-id");

    await userEvent.click(screen.getByRole("button", { name: "コピー" }));

    expect(await screen.findByRole("button", { name: "コピー済み" })).toBeInTheDocument();
    expect(screen.queryByText("コピーしました")).toBeNull();
  });

  it("TC-UT_P208-025 属性の値は、null を「―」、真偽値を文字に、オブジェクトを JSON にして出す", () => {
    render(
      <InputSection
        event={eventDetail({ inputAttributes: { bio: null, flag: true, extra: { a: 1 } } })}
        refPosts={[]}
      />,
    );

    const attrs = screen.getByText("入力に用いた属性").parentElement!;
    const rows = within(attrs).getAllByRole("row").slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ["自己紹介", "―"],
      ["flag", "true"],
      ["extra", '{"a":1}'],
    ]);
  });
});
