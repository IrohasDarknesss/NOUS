// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_P205.json
import { DEFAULT_SETTINGS, MODEL_OPTIONS, type SettingsResponse } from "@nous/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk, type MockResponse, type MockRoutes } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { validateSettingsField } from "./RunSettingsPage";

afterEach(() => vi.unstubAllGlobals());

const settingsOkBody: SettingsResponse = {
  settings: { ...DEFAULT_SETTINGS },
  avgNeuronsPerRun: 15.8,
  activeAgents: 10,
  avgParticipation: 0.6,
  estimatedCycleMinutes: 15,
  estimatedDailyRuns: 432,
  estimatedDailyNeurons: 6826,
  modelOptions: [...MODEL_OPTIONS],
  promptVersions: ["v1", "v2"],
};

const putOk: MockResponse = {
  status: 200,
  body: { settings: { ...DEFAULT_SETTINGS }, estimatedCycleMinutes: 15, estimatedDailyRuns: 432, stateChanged: null },
};

async function openSettings(routes: MockRoutes = {}) {
  const mock = mockFetch({
    "GET /admin/api/session": sessionOk,
    "GET /admin/api/world": worldOk,
    "GET /admin/api/settings": { status: 200, body: settingsOkBody },
    "GET /admin/api/audit-logs": { status: 200, body: { items: [], nextCursor: null } },
    ...routes,
  });
  const utils = renderApp("/settings");
  await screen.findByLabelText("周期（分）");
  return { ...utils, mock };
}

function callsTo(mock: ReturnType<typeof mockFetch>, method: string, path: string) {
  return mock.mock.calls.filter(
    ([url, init]) => String(url).split("?")[0] === path && (init?.method ?? "GET") === method,
  );
}

async function replace(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
  return input;
}

describe("validateSettingsField（単体テスト）", () => {
  it.each([
    [" 20 ", null],
    ["020", null],
    ["1e2", "15〜120 の整数で入力してください"],
    ["+20", "15〜120 の整数で入力してください"],
    ["20.0", "15〜120 の整数で入力してください"],
  ])(
    "TC-UT_P205-006 入力の文字列は前後の空白を除いて 10 進の整数だけを受け、指数・符号・小数点の表記は範囲外の文言にする（%j）",
    (value, expected) => {
      const message = validateSettingsField("cycleMinutes", value);

      expect(message).toBe(expected);
    },
  );
});

describe("P205 RunSettingsPage（単体テスト）", () => {
  it("TC-UT_P205-007 範囲外を入力するとすぐ入力欄の下に文言を出し、範囲内に直すと消す", async () => {
    await openSettings();

    await replace("活動量（%）", "5");
    const shown = screen.queryByText("10〜100 の整数で入力してください");
    await replace("活動量（%）", "50");

    expect(shown).toBeInTheDocument();
    expect(screen.queryByText("10〜100 の整数で入力してください")).toBeNull();
  });

  it("TC-UT_P205-008 検証に通らない項目があるときに保存を押すと、PUT を送らずに文言を出したままにする", async () => {
    const { mock } = await openSettings({ "PUT /admin/api/settings": putOk });

    await replace("並列数の上限", "4");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(callsTo(mock, "PUT", "/admin/api/settings")).toHaveLength(0);
    expect(screen.getByText("1〜3 の整数で入力してください")).toBeInTheDocument();
  });

  it("TC-UT_P205-009 変更がないときは保存と元に戻すを押せず、値を変えると押せるようにする", async () => {
    await openSettings();
    const save = screen.getByRole("button", { name: "保存" });
    const revert = screen.getByRole("button", { name: "元に戻す" });
    const before = [save.hasAttribute("disabled"), revert.hasAttribute("disabled")];

    await replace("周期（分）", "30");

    expect(before).toEqual([true, true]);
    expect(save).toBeEnabled();
    expect(revert).toBeEnabled();
  });

  it("TC-UT_P205-010 モデルとプロンプトの版を変えると、保存の PUT の本文にその値を入れる", async () => {
    const { mock } = await openSettings({ "PUT /admin/api/settings": putOk });

    await userEvent.selectOptions(screen.getByLabelText("モデル"), MODEL_OPTIONS[1]);
    await userEvent.selectOptions(screen.getByLabelText("プロンプトの版"), "v2");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(callsTo(mock, "PUT", "/admin/api/settings")).toHaveLength(1));
    const body = JSON.parse(String(callsTo(mock, "PUT", "/admin/api/settings")[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ modelId: MODEL_OPTIONS[1], promptVersion: "v2", cycleMinutes: 20 });
  });

  it("TC-UT_P205-011 保存が 500 なら様式①「保存に失敗しました。時間をおいて再度お試しください」を出し、入力は残す", async () => {
    await openSettings({
      "PUT /admin/api/settings": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } },
    });

    const input = await replace("周期（分）", "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存に失敗しました。時間をおいて再度お試しください")).toBeInTheDocument();
    expect(input).toHaveValue(30);
  });

  it("TC-UT_P205-012 ページを開いたときの設定の取得が 500 なら様式①「設定を取得できませんでした」を出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } },
    });

    renderApp("/settings");

    expect(await screen.findByText("設定を取得できませんでした")).toBeInTheDocument();
  });

  it("TC-UT_P205-013 見込みの枠に、1回の平均・1巡・1日の見込み・周期の下限を出す", async () => {
    await openSettings();

    const panel = screen.getByRole("region", { name: "生成量の見込み" });

    expect(within(panel).getByText("15.8 Neurons")).toBeInTheDocument();
    expect(within(panel).getByText("約 95 Neurons")).toBeInTheDocument();
    expect(within(panel).getByText("約 6,826 Neurons・約 432 回")).toBeInTheDocument();
    expect(within(panel).getByText("約 15 分")).toBeInTheDocument();
  });

  it("TC-UT_P205-014 保存の応答に stateChanged がなければ基本の文言だけのトーストを出し、世界の状態を取り直す", async () => {
    const { mock } = await openSettings({ "PUT /admin/api/settings": putOk });
    const before = callsTo(mock, "GET", "/admin/api/world").length;

    await replace("周期（分）", "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^保存しました。周期と活動量は次の巡から反映します$/);
    await waitFor(() => expect(callsTo(mock, "GET", "/admin/api/world").length).toBeGreaterThan(before));
  });

  it("TC-UT_P205-015 未保存の確認で「移動する」を押すと移動し、「キャンセル」なら実行設定に残る", async () => {
    const { router } = await openSettings();
    await replace("周期（分）", "30");

    await userEvent.click(screen.getByRole("link", { name: "実行制御" }));
    await userEvent.click(await screen.findByRole("button", { name: "キャンセル" }));
    const afterCancel = router.state.location.pathname;
    await userEvent.click(screen.getByRole("link", { name: "実行制御" }));
    await userEvent.click(await screen.findByRole("button", { name: "移動する" }));

    expect(afterCancel).toBe("/settings");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("TC-UT_P205-016 保存が fields のない 400 なら、サーバーの message をボタンの上（様式④）に出す", async () => {
    await openSettings({
      "PUT /admin/api/settings": {
        status: 400,
        body: { error: { code: "VALIDATION_ERROR", message: "入力の内容を確認してください" } },
      },
    });

    await replace("周期（分）", "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("入力の内容を確認してください")).toBeInTheDocument();
  });

  it("TC-UT_P205-017 設定の応答のモデルと版の一覧が空なら、画面の既定の選択肢（モデル 2 値・v1）を使う", async () => {
    await openSettings({
      "GET /admin/api/settings": { status: 200, body: { ...settingsOkBody, modelOptions: [], promptVersions: [] } },
    });

    const models = within(screen.getByLabelText("モデル"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    const versions = within(screen.getByLabelText("プロンプトの版"))
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(models).toEqual([...MODEL_OPTIONS]);
    expect(versions).toEqual(["v1"]);
  });

  it("TC-UT_P205-018 ページを開いたときの設定の取得が 401 なら、様式①「ログインの有効期限が切れました…」を出す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 401, body: { error: { code: "ADMIN_UNAUTHORIZED", message: "x" } } },
    });

    renderApp("/settings");

    expect(await screen.findByText("ログインの有効期限が切れました。もう一度ログインしてください")).toBeInTheDocument();
  });

  it("TC-UT_P205-019 設定の取得が 404 なら様式を出さず、既定の値でフォームを出す", async () => {
    await openSettings({
      "GET /admin/api/settings": { status: 404, body: { error: { code: "INTERNAL_ERROR", message: "not found" } } },
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("周期（分）")).toHaveValue(DEFAULT_SETTINGS.cycleMinutes);
  });

  it("TC-UT_P205-020 設定の取得が画面で扱わない 4xx（403）なら、サーバーの message を様式②に出す", async () => {
    await openSettings({
      "GET /admin/api/settings": {
        status: 403,
        body: { error: { code: "FORBIDDEN_NETWORK", message: "この端末からは開けません" } },
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("この端末からは開けません");
  });

  it("TC-UT_P205-021 保存が 409 なら fields を返さず、サーバーの message を様式②に出す", async () => {
    await openSettings({
      "PUT /admin/api/settings": {
        status: 409,
        body: { error: { code: "STATE_CONFLICT", message: "世界の状態が変わりました" } },
      },
    });

    await replace("周期（分）", "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("世界の状態が変わりました");
    expect(screen.getByLabelText("周期（分）")).toHaveValue(30);
  });
});
