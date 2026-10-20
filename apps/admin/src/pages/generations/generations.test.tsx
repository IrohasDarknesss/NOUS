// P207 生成ログ一覧・P208 生成ログ詳細の単体・画面テスト（FE 詳細設計 admin_agents_logs 4章・6章）
import type { AgentListResponse, GenerationDetail, GenerationPage } from "@nous/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colors } from "../../shared/theme";
import { mockFetch, sessionOk, worldOk } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { describeFlag } from "./ConsistencyFlags";
import { searchByEventId, toLocalDateTime, toUtcIso } from "./GenerationFilters";
import { STATUS_COLORS, StatusBadge } from "./StatusBadge";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sampleAgents: AgentListResponse = {
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

const sampleGenerationsPage: GenerationPage = {
  items: [
    {
      eventId: "01JABCDEFGHJKMNPQRSTVWXYZ2",
      startedAt: "2026-10-22T05:20:00.000Z",
      worldTimeSec: 7200,
      agent: { agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1", displayName: "ミナト" },
      action: "post",
      decidedBy: "llm",
      status: "succeeded",
      failureKind: null,
      neurons: 15.2,
      attemptCount: 1,
      hasConsistencyFlags: true,
    },
  ],
  nextCursor: null,
};

const sampleDetail: GenerationDetail = {
  event: {
    eventId: "01JABCDEFGHJKMNPQRSTVWXYZ2",
    worldId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
    agent: { agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1", displayName: "ミナト", handle: "minato" },
    cycleNo: 22,
    cycleSeed: 834201,
    status: "succeeded",
    decidedBy: "llm",
    action: "post",
    failureKind: null,
    actionCandidates: ["post", "like"],
    inputAttributes: { displayName: "ミナト", interests: "都市観察" },
    inputMemories: [{ kind: "interest_profile", content: "興味：都市観察" }],
    inputPostIds: ["01JABCDEFGHJKMNPQRSTVWXYZ3"],
    promptText: "SYSTEM: あなたはミナトです\nUSER: 行動を選んでください",
    outputText: '{"action":"post","body":"雨上がりの街角は静かだ。"}',
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    promptVersion: "v1",
    llmMode: "cloudflare",
    promptTokens: 1480,
    completionTokens: 72,
    neurons: 15.2,
    costJpy: 0,
    consistencyFlags: [
      { code: "C01", detail: "解除後 2 巡で返信" },
      { code: "C03", detail: "一人称「俺」を使用" },
    ],
    worldTimeSec: 7200,
    startedAt: "2026-10-22T05:20:00.000Z",
    finishedAt: "2026-10-22T05:20:02.000Z",
  },
  attempts: [
    {
      attemptNo: 1,
      result: "ok",
      httpStatus: 200,
      errorDetail: null,
      promptTokens: 1480,
      completionTokens: 72,
      neurons: 15.2,
      durationMs: 1930,
    },
  ],
  refPosts: [
    {
      label: "P1",
      postId: "01JABCDEFGHJKMNPQRSTVWXYZ3",
      excerpt: "朝の珈琲を淹れた。",
    },
  ],
  resultPost: {
    postId: "01JABCDEFGHJKMNPQRSTVWXYZ4",
    body: "雨上がりの街角は静かだ。",
    visibility: "public",
  },
};

describe("P207 生成ログ一覧・P208 生成ログ詳細", () => {
  it("TC-NOUS71_DEV-07 searchByEventId：26 字の ULID でなければエラー、合えば /generations/{id} へ移動する", () => {
    const navigate = vi.fn();
    expect(searchByEventId("short", navigate)).toBe("実行 ID は 26 字です");
    expect(searchByEventId("01JABCDEFGHJKMNPQRSTVWXYZI", navigate)).toBe("実行 ID は 26 字です"); // I は Crockford Base32 外
    expect(navigate).not.toHaveBeenCalled();

    const validId = "01JABCDEFGHJKMNPQRSTVWXYZ2";
    expect(searchByEventId(validId, navigate)).toBeNull();
    expect(navigate).toHaveBeenCalledWith(`/generations/${validId}`);
  });

  it("TC-NOUS71_DEV-08 toUtcIso / toLocalDateTime：JST の入力と UTC の ISO 8601 を相互に変換する", () => {
    const iso = toUtcIso("2026-10-22T14:20");
    expect(iso).toBe("2026-10-22T05:20:00.000Z");
    expect(toLocalDateTime(iso)).toBe("2026-10-22T14:20");
    expect(toLocalDateTime(undefined)).toBe("");
    expect(toUtcIso("")).toBe("");
  });

  it("TC-NOUS71_DEV-09 describeFlag：C01〜C04 を日本語の説明に変える", () => {
    expect(describeFlag("C01")).toBe("解除した相手への 3 巡以内の返信");
    expect(describeFlag("C02")).toBe("過去の発言の繰り返し");
    expect(describeFlag("C03")).toBe("口調に合わない一人称");
    expect(describeFlag("C04")).toBe("存在しない住人への言及");
    expect(describeFlag({ code: "C02", detail: "重複" })).toBe("過去の発言の繰り返し");
  });

  it("TC-NOUS71_DEV-10 StatusBadge：状態ごとの色と文言を出し、失敗のときは failureKind も出す", () => {
    const { rerender } = render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("成功")).toHaveStyle({ background: colors.success });

    rerender(<StatusBadge status="failed" failureKind="invalid_format" />);
    expect(screen.getByText("失敗（不正な形式）")).toHaveStyle({ background: colors.danger });

    rerender(<StatusBadge status="cancelled" failureKind="cancelled" />);
    expect(screen.getByText("取り消し（取り消し）")).toHaveStyle({ background: STATUS_COLORS.cancelled });

    rerender(<StatusBadge status="interrupted" />);
    expect(screen.getByText("中断")).toHaveStyle({ background: colors.subText });

    rerender(<StatusBadge status="running" />);
    expect(screen.getByText("実行中")).toHaveStyle({ background: colors.primary });
  });

  it("TC-NOUS71_DEV-11 GenerationListPage：絞り込みの変更が URL の検索パラメータに入り、行クリックで詳細へ遷移する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: sampleAgents },
      "GET /admin/api/generations": { status: 200, body: sampleGenerationsPage },
      "GET /admin/api/generations/01JABCDEFGHJKMNPQRSTVWXYZ2": { status: 200, body: sampleDetail },
    });
    const { router } = renderApp("/generations");

    expect(await screen.findByText("ミナト")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("状態"), "failed");
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("status")).toBe("failed"));

    await userEvent.selectOptions(screen.getByLabelText("行動"), "post");
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("action")).toBe("post"));

    await userEvent.click(screen.getByText("ミナト"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/generations/01JABCDEFGHJKMNPQRSTVWXYZ2"));
  });

  it("TC-NOUS71_DEV-12 GenerationDetailPage：プロンプトの開閉・試行・矛盾の候補・生成された投稿を描画する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/generations/01JABCDEFGHJKMNPQRSTVWXYZ2": { status: 200, body: sampleDetail },
    });
    const { router } = renderApp("/generations/01JABCDEFGHJKMNPQRSTVWXYZ2");

    expect(await screen.findByTestId("event-id")).toHaveTextContent("01JABCDEFGHJKMNPQRSTVWXYZ2");
    expect(screen.getByTestId("output-text")).toHaveTextContent('{"action":"post","body":"雨上がりの街角は静かだ。"}');

    // 入力の全文は初期状態で折りたたまれている
    expect(screen.queryByTestId("prompt-text")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "入力の全文を開く" }));
    expect(screen.getByTestId("prompt-text")).toHaveTextContent("SYSTEM: あなたはミナトです");

    // 試行の表
    expect(screen.getByText("1,930 ms")).toBeInTheDocument();

    // 矛盾の候補
    expect(screen.getByText(/C01：解除した相手への 3 巡以内の返信/)).toBeInTheDocument();
    expect(screen.getByText("（解除後 2 巡で返信）")).toBeInTheDocument();
    expect(screen.getByText(/C03：口調に合わない一人称/)).toBeInTheDocument();

    // 生成された投稿と非表示管理で開くリンク
    expect(screen.getByTestId("result-post-body")).toHaveTextContent("雨上がりの街角は静かだ。");
    await userEvent.click(screen.getByRole("link", { name: "非表示管理で開く" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/moderation"));
    expect(router.state.location.search).toBe("?postId=01JABCDEFGHJKMNPQRSTVWXYZ4");
  });

  it("TC-NOUS71_DEV-13 GenerationDetailPage：404 EVENT_NOT_FOUND のときは「生成イベントが見つかりません」と一覧へのリンクを表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/generations/01JABCDEFGHJKMNPQRSTVWXYZ9": {
        status: 404,
        body: { error: { code: "EVENT_NOT_FOUND", message: "生成イベントが見つかりません" } },
      },
    });
    renderApp("/generations/01JABCDEFGHJKMNPQRSTVWXYZ9");

    expect(await screen.findByText("生成イベントが見つかりません")).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: "生成ログ一覧へ戻る" });
    expect(backLink).toHaveAttribute("href", "/generations");
  });
});
