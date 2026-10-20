import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAgentItem, WorldState } from "@nous/shared";
import { mockFetch, sessionOk, worldOk, type MockResponse } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { participationLabel } from "./ActivityLevelRadio";
import { AGENT_VALIDATION_MESSAGES, createInitialAgentForm, validateAgentForm, type AgentForm } from "./agentForm";
import { rowActionStates } from "./AgentRowActions";

afterEach(() => {
  vi.unstubAllGlobals();
});

const validForm: AgentForm = {
  handle: "minato_01",
  displayName: "ミナト",
  bio: "港町の住人です",
  interests: "季節の食材、天気",
  topics: "地域の暮らし",
  personality: "素朴で温かい口調。丁寧語",
  valuesText: "日々のつながりを大切にする",
  stance: "穏やかに耳を傾ける",
  activityLevel: 3,
  noRealPersonConfirmed: true,
};

const agentActive: AdminAgentItem = {
  agentId: "01JABCDEFGHJKMNPQRSTVWXYZ1",
  handle: "minato",
  displayName: "ミナト",
  state: "active",
  activityLevel: 3,
  postCount: 37,
  lastActionAt: "2026-10-22T05:20:00.000Z",
  lastAction: "post",
};

const agentStopped: AdminAgentItem = {
  agentId: "01JABCDEFGHJKMNPQRSTVWXYZ2",
  handle: "zen",
  displayName: "ゼン",
  state: "stopped",
  activityLevel: 2,
  postCount: 12,
  lastActionAt: null,
  lastAction: null,
};

const worldPreparing: MockResponse = {
  status: 200,
  body: {
    ...(worldOk.body as Record<string, unknown>),
    state: "preparing",
    agentCounts: { active: 1, stopped: 1 },
  },
};

const worldRunning: MockResponse = {
  status: 200,
  body: {
    ...(worldOk.body as Record<string, unknown>),
    state: "running",
    agentCounts: { active: 1, stopped: 1 },
  },
};

describe("validateAgentForm", () => {
  it("TC-NOUS70_DEV-01 正しい入力ではエラーを返さない", () => {
    expect(validateAgentForm(validForm)).toEqual({});
    expect(createInitialAgentForm().activityLevel).toBe(3);
    expect(createInitialAgentForm().noRealPersonConfirmed).toBe(false);
  });

  it("TC-NOUS70_DEV-02 必須項目が空または空白のみのとき「入力してください」と確認エラーを返す", () => {
    const empty = createInitialAgentForm();
    expect(validateAgentForm({ ...empty, handle: "   " })).toEqual({
      handle: AGENT_VALIDATION_MESSAGES.required,
      displayName: AGENT_VALIDATION_MESSAGES.required,
      interests: AGENT_VALIDATION_MESSAGES.required,
      topics: AGENT_VALIDATION_MESSAGES.required,
      personality: AGENT_VALIDATION_MESSAGES.required,
      valuesText: AGENT_VALIDATION_MESSAGES.required,
      stance: AGENT_VALIDATION_MESSAGES.required,
      noRealPersonConfirmed: AGENT_VALIDATION_MESSAGES.noRealPersonConfirmed,
    });
  });

  it.each([
    ["TC-NOUS70_DEV-03", "ab", AGENT_VALIDATION_MESSAGES.handleFormat],
    ["TC-NOUS70_DEV-04", "a".repeat(21), AGENT_VALIDATION_MESSAGES.handleFormat],
    ["TC-NOUS70_DEV-05", "minato-01", AGENT_VALIDATION_MESSAGES.handleFormat],
  ])("%s ハンドルが不正（%s）のとき形式エラーを返す", (_id, handle, expected) => {
    expect(validateAgentForm({ ...validForm, handle }).handle).toBe(expected);
  });

  it("TC-NOUS70_DEV-06 文字数超過と活動頻度範囲外のエラーメッセージを返す", () => {
    const over: AgentForm = {
      ...validForm,
      displayName: "あ".repeat(31),
      bio: "あ".repeat(201),
      interests: "あ".repeat(101),
      topics: "あ".repeat(101),
      personality: "あ".repeat(101),
      valuesText: "あ".repeat(101),
      stance: "あ".repeat(101),
      activityLevel: 6,
    };
    expect(validateAgentForm(over)).toEqual({
      displayName: AGENT_VALIDATION_MESSAGES.displayNameMax,
      bio: AGENT_VALIDATION_MESSAGES.bioMax,
      interests: AGENT_VALIDATION_MESSAGES.attributeMax,
      topics: AGENT_VALIDATION_MESSAGES.attributeMax,
      personality: AGENT_VALIDATION_MESSAGES.attributeMax,
      valuesText: AGENT_VALIDATION_MESSAGES.attributeMax,
      stance: AGENT_VALIDATION_MESSAGES.attributeMax,
      activityLevel: AGENT_VALIDATION_MESSAGES.activityLevel,
    });
  });
});

describe("rowActionStates / participationLabel", () => {
  it.each([
    [
      "TC-NOUS70_DEV-07",
      "active" as const,
      "preparing" as WorldState,
      { stop: false, resume: false, edit: true, delete: true, logs: false },
    ],
    [
      "TC-NOUS70_DEV-08",
      "active" as const,
      "running" as WorldState,
      { stop: true, resume: false, edit: false, delete: false, logs: true },
    ],
    [
      "TC-NOUS70_DEV-09",
      "stopped" as const,
      "paused" as WorldState,
      { stop: false, resume: true, edit: false, delete: false, logs: true },
    ],
    [
      "TC-NOUS70_DEV-10",
      "active" as const,
      "archived" as WorldState,
      { stop: false, resume: false, edit: false, delete: false, logs: true },
    ],
  ])("%s agent=%s, world=%s のボタン出し分け", (_id, agentState, worldState, expected) => {
    expect(rowActionStates({ state: agentState }, worldState)).toEqual(expected);
  });

  it.each([
    ["TC-NOUS70_DEV-11", 1, "行動機会の約 30% で行動します"],
    ["TC-NOUS70_DEV-12", 2, "行動機会の約 45% で行動します"],
    ["TC-NOUS70_DEV-13", 3, "行動機会の約 60% で行動します"],
    ["TC-NOUS70_DEV-14", 4, "行動機会の約 75% で行動します"],
    ["TC-NOUS70_DEV-15", 5, "行動機会の約 90% で行動します"],
  ])("%s 活動頻度 %d の説明は「%s」", (_id, level, expected) => {
    expect(participationLabel(level)).toBe(expected);
  });
});

describe("P203 AgentListPage", () => {
  it("TC-NOUS70_DEV-16 稼働中の世界では一覧・最後の行動（JST）・停止・再開・生成ログを出し、絞り込みタブで取得し直す", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldRunning,
      "GET /admin/api/agents": () => ({
        status: 200,
        body: { items: [agentActive, agentStopped], worldState: "running" },
      }),
    });

    renderApp("/agents");

    expect(await screen.findByRole("heading", { name: /エージェント（稼働 1・停止 1）/ })).toBeInTheDocument();
    expect(screen.getByText("ミナト")).toBeInTheDocument();
    expect(screen.getByText("@minato")).toBeInTheDocument();
    // 2026-10-22T05:20:00.000Z → JST 14:20
    expect(screen.getByText("14:20 post")).toBeInTheDocument();
    expect(screen.getByText("―")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "新規登録" })).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再開" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "生成ログ" })[0]).toHaveAttribute(
      "href",
      `/generations?agentId=${agentActive.agentId}`,
    );

    await userEvent.click(screen.getByRole("tab", { name: "稼働" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      expect(urls).toContain("/admin/api/agents?state=active");
    });
  });

  it("TC-NOUS70_DEV-17 停止は確認ダイアログの後に POST stop を呼び、トーストを出す。再開は確認なしで呼ぶ", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldRunning,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [agentActive, agentStopped], worldState: "running" },
      },
      [`POST /admin/api/agents/${agentActive.agentId}/stop`]: {
        status: 200,
        body: { agentId: agentActive.agentId, state: "stopped" },
      },
      [`POST /admin/api/agents/${agentStopped.agentId}/resume`]: {
        status: 200,
        body: { agentId: agentStopped.agentId, state: "active" },
      },
    });

    renderApp("/agents");
    await screen.findByText("ミナト");

    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("停止しますか。次の行動機会から割り当てません")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "停止する" }));

    expect(await screen.findByRole("status")).toHaveTextContent("停止しました。次の行動機会から割り当てません");

    await userEvent.click(screen.getByRole("button", { name: "再開" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      expect(urls).toContain(`/admin/api/agents/${agentStopped.agentId}/resume`);
    });
  });

  it("TC-NOUS70_DEV-18 準備中の世界では新規登録・編集・削除を出し、削除は確認後に DELETE を呼ぶ", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldPreparing,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [agentActive], worldState: "preparing" },
      },
      [`DELETE /admin/api/agents/${agentActive.agentId}`]: {
        status: 204,
      },
    });

    renderApp("/agents");
    await screen.findByText("ミナト");

    expect(screen.getByRole("link", { name: "新規登録" })).toHaveAttribute("href", "/agents/new");
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", `/agents/${agentActive.agentId}/edit`);

    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("削除しますか。元に戻せません")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u) === `/admin/api/agents/${agentActive.agentId}` && init?.method === "DELETE",
      );
      expect(calls).toHaveLength(1);
    });
  });

  it("TC-NOUS70_DEV-19 停止で 409 ALREADY_STOPPED が返ったときは様式②（ErrorBanner）に文言を出し一覧を再取得する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldRunning,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [agentActive], worldState: "running" },
      },
      [`POST /admin/api/agents/${agentActive.agentId}/stop`]: {
        status: 409,
        body: { error: { code: "ALREADY_STOPPED", message: "すでに停止しています" } },
      },
    });

    renderApp("/agents");
    await screen.findByText("ミナト");

    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    await userEvent.click(screen.getByRole("button", { name: "停止する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "エージェントの状態が変わったため、操作できませんでした。一覧を更新します",
    );
    const agentGets = fetchMock.mock.calls.filter(([u, init]) => String(u) === "/admin/api/agents" && !init?.method);
    expect(agentGets.length).toBeGreaterThanOrEqual(2);
  });
});

describe("P204 AgentEditPage", () => {
  it("TC-NOUS70_DEV-20 世界が準備中でないときは「世界が開始された後は、エージェントを編集できません」だけを出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldRunning,
    });

    renderApp("/agents/new");

    expect(await screen.findByText("世界が開始された後は、エージェントを編集できません")).toBeInTheDocument();
    expect(screen.queryByLabelText("ハンドル")).toBeNull();
  });

  it("TC-NOUS70_DEV-21 入力欄の blur と未チェックでの保存で様式④エラーを出し、全項目入力・確認チェックで新規登録して /agents へ遷移する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldPreparing,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [agentActive], worldState: "preparing" },
      },
      "POST /admin/api/agents": {
        status: 201,
        body: { agentId: "01JABCDEFGHJKMNPQRSTVWXYZ9" },
      },
    });

    const { router } = renderApp("/agents/new");
    const handleInput = await screen.findByLabelText("ハンドル");

    // blur で単一欄の検証
    await userEvent.click(handleInput);
    await userEvent.tab();
    expect(screen.getByText("入力してください")).toBeInTheDocument();

    await userEvent.type(handleInput, "minato_01");
    await userEvent.type(screen.getByLabelText("表示名"), "ミナト");
    await userEvent.type(screen.getByLabelText("興味"), "天気");
    await userEvent.type(screen.getByLabelText("関心分野"), "地域");
    await userEvent.type(screen.getByLabelText("性格"), "穏やか");
    await userEvent.type(screen.getByLabelText("価値観"), "誠実");
    await userEvent.type(screen.getByLabelText("主張傾向"), "中立");

    // 確認未チェックのまま保存 → 保存しない
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("確認の欄を選んでください")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([u, init]) => String(u) === "/admin/api/agents" && init?.method === "POST"),
    ).toHaveLength(0);

    // チェックを入れて保存
    await userEvent.click(screen.getByRole("checkbox", { name: "実在の人物・団体や、機微な個人情報を含みません" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/agents"));
    expect(screen.getByRole("status")).toHaveTextContent("保存しました");
  });

  it("TC-NOUS70_DEV-22 保存時の 409 HANDLE_TAKEN はハンドルの欄に「このハンドルは使われています」を出し、409 STATE_CONFLICT は様式②を出す", async () => {
    let callCount = 0;
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldPreparing,
      "POST /admin/api/agents": () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            status: 409,
            body: { error: { code: "HANDLE_TAKEN", message: "重複" } },
          };
        }
        return {
          status: 409,
          body: { error: { code: "STATE_CONFLICT", message: "開始済み" } },
        };
      },
    });

    renderApp("/agents/new");
    await userEvent.type(await screen.findByLabelText("ハンドル"), "minato_01");
    await userEvent.type(screen.getByLabelText("表示名"), "ミナト");
    await userEvent.type(screen.getByLabelText("興味"), "天気");
    await userEvent.type(screen.getByLabelText("関心分野"), "地域");
    await userEvent.type(screen.getByLabelText("性格"), "穏やか");
    await userEvent.type(screen.getByLabelText("価値観"), "誠実");
    await userEvent.type(screen.getByLabelText("主張傾向"), "中立");
    await userEvent.click(screen.getByRole("checkbox", { name: "実在の人物・団体や、機微な個人情報を含みません" }));

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("このハンドルは使われています")).toBeInTheDocument();

    // ハンドルを書き換えて再送信 → STATE_CONFLICT で ErrorBanner
    await userEvent.type(screen.getByLabelText("ハンドル"), "2");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("世界が開始されたため、保存できませんでした")).toBeInTheDocument();
  });

  it("TC-NOUS70_DEV-23 入力変更後に取消を押すと「入力を破棄しますか」の ConfirmDialog を出し、確定で /agents へ戻る", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldPreparing,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [], worldState: "preparing" },
      },
    });

    const { router } = renderApp("/agents/new");
    await userEvent.type(await screen.findByLabelText("表示名"), "ミナト");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("入力を破棄しますか")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "破棄する" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/agents"));
  });

  it("TC-NOUS70_DEV-24 編集（/agents/:agentId/edit）で一覧から対象を読み込んで PUT updateAgent を呼び、見つからなければ様式③を出す", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldPreparing,
      "GET /admin/api/agents": {
        status: 200,
        body: { items: [agentActive], worldState: "preparing" },
      },
      [`PUT /admin/api/agents/${agentActive.agentId}`]: {
        status: 200,
        body: { agentId: agentActive.agentId },
      },
    });

    const { router, unmount } = renderApp(`/agents/${agentActive.agentId}/edit`);
    const handleInput = await screen.findByLabelText("ハンドル");
    await waitFor(() => expect(handleInput).toHaveValue("minato"));
    expect(screen.getByLabelText("表示名")).toHaveValue("ミナト");

    await userEvent.type(screen.getByLabelText("興味"), "天気");
    await userEvent.type(screen.getByLabelText("関心分野"), "地域");
    await userEvent.type(screen.getByLabelText("性格"), "穏やか");
    await userEvent.type(screen.getByLabelText("価値観"), "誠実");
    await userEvent.type(screen.getByLabelText("主張傾向"), "中立");
    await userEvent.click(screen.getByRole("checkbox", { name: "実在の人物・団体や、機微な個人情報を含みません" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/agents"));
    const putCalls = fetchMock.mock.calls.filter(
      ([u, init]) => String(u) === `/admin/api/agents/${agentActive.agentId}` && init?.method === "PUT",
    );
    expect(putCalls).toHaveLength(1);

    unmount();
    renderApp("/agents/01JNOTFOUNDAGENT0000000000/edit");
    expect(await screen.findByText("エージェントが見つかりません")).toBeInTheDocument();
  });
});
