import { DEFAULT_SETTINGS, MODEL_OPTIONS, type SettingsResponse } from "@nous/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { LIMIT_WARNING_MESSAGE } from "./runSettings/LimitWarning";
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

describe("P205 RunSettingsPage", () => {
  it("TC-NOUS69_DEV-20 validateSettingsField は全 9 項目の境界値と整数判定を行う", () => {
    expect(validateSettingsField("cycleMinutes", 14)).toBe("15〜120 の整数で入力してください");
    expect(validateSettingsField("cycleMinutes", 15)).toBeNull();
    expect(validateSettingsField("cycleMinutes", 120)).toBeNull();
    expect(validateSettingsField("cycleMinutes", 121)).toBe("15〜120 の整数で入力してください");
    expect(validateSettingsField("cycleMinutes", "20.5")).toBe("15〜120 の整数で入力してください");
    expect(validateSettingsField("cycleMinutes", "")).toBe("15〜120 の整数で入力してください");

    expect(validateSettingsField("activityPercent", 9)).toBe("10〜100 の整数で入力してください");
    expect(validateSettingsField("activityPercent", 10)).toBeNull();
    expect(validateSettingsField("activityPercent", 100)).toBeNull();
    expect(validateSettingsField("activityPercent", 101)).toBe("10〜100 の整数で入力してください");

    expect(validateSettingsField("maxRefPosts", 0)).toBe("1〜30 の整数で入力してください");
    expect(validateSettingsField("maxRefPosts", 1)).toBeNull();
    expect(validateSettingsField("maxRefPosts", 30)).toBeNull();
    expect(validateSettingsField("maxRefPosts", 31)).toBe("1〜30 の整数で入力してください");

    expect(validateSettingsField("maxMemoryChars", 199)).toBe("200〜3000 の整数で入力してください");
    expect(validateSettingsField("maxMemoryChars", 200)).toBeNull();
    expect(validateSettingsField("maxMemoryChars", 3000)).toBeNull();
    expect(validateSettingsField("maxMemoryChars", 3001)).toBe("200〜3000 の整数で入力してください");

    expect(validateSettingsField("maxInputTokens", 499)).toBe("500〜2000 の整数で入力してください");
    expect(validateSettingsField("maxInputTokens", 500)).toBeNull();
    expect(validateSettingsField("maxInputTokens", 2000)).toBeNull();
    expect(validateSettingsField("maxInputTokens", 2001)).toBe("500〜2000 の整数で入力してください");

    expect(validateSettingsField("maxOutputTokens", 99)).toBe("100〜400 の整数で入力してください");
    expect(validateSettingsField("maxOutputTokens", 100)).toBeNull();
    expect(validateSettingsField("maxOutputTokens", 400)).toBeNull();
    expect(validateSettingsField("maxOutputTokens", 401)).toBe("100〜400 の整数で入力してください");

    expect(validateSettingsField("dailyNeuronsLimit", 0)).toBe("1〜10000 の整数で入力してください");
    expect(validateSettingsField("dailyNeuronsLimit", 1)).toBeNull();
    expect(validateSettingsField("dailyNeuronsLimit", 10000)).toBeNull();
    expect(validateSettingsField("dailyNeuronsLimit", 10001)).toBe("1〜10000 の整数で入力してください");

    expect(validateSettingsField("dailyRunsLimit", 0)).toBe("1〜2000 の整数で入力してください");
    expect(validateSettingsField("dailyRunsLimit", 1)).toBeNull();
    expect(validateSettingsField("dailyRunsLimit", 2000)).toBeNull();
    expect(validateSettingsField("dailyRunsLimit", 2001)).toBe("1〜2000 の整数で入力してください");

    expect(validateSettingsField("maxConcurrency", 0)).toBe("1〜3 の整数で入力してください");
    expect(validateSettingsField("maxConcurrency", 1)).toBeNull();
    expect(validateSettingsField("maxConcurrency", 3)).toBeNull();
    expect(validateSettingsField("maxConcurrency", 4)).toBe("1〜3 の整数で入力してください");
  });

  it("TC-NOUS69_DEV-21 P205 入力値の変更で見込みを再計算し、上限超過で LimitWarning を表示し、元に戻すで初期値に復帰する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 200, body: settingsOkBody },
    });
    renderApp("/settings");

    const neuronsInput = await screen.findByLabelText("Neurons の日次上限");
    expect(screen.queryByText(LIMIT_WARNING_MESSAGE)).toBeNull();

    await userEvent.clear(neuronsInput);
    await userEvent.type(neuronsInput, "5000");

    expect(screen.getByText(LIMIT_WARNING_MESSAGE)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(neuronsInput).toHaveValue(9500);
    expect(screen.queryByText(LIMIT_WARNING_MESSAGE)).toBeNull();
  });

  it("TC-NOUS69_DEV-22 P205 保存成功で PUT /admin/api/settings を送りトーストを表示し、stateChanged があれば追記する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 200, body: settingsOkBody },
      "PUT /admin/api/settings": {
        status: 200,
        body: {
          settings: { ...DEFAULT_SETTINGS, cycleMinutes: 30 },
          estimatedCycleMinutes: 15,
          estimatedDailyRuns: 288,
          stateChanged: "limit_stopped→running",
        },
      },
    });
    renderApp("/settings");

    const cycleInput = await screen.findByLabelText("周期（分）");
    await userEvent.clear(cycleInput);
    await userEvent.type(cycleInput, "30");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "保存しました。周期と活動量は次の巡から反映します。上限停止が解けました",
    );
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url) === "/admin/api/settings" && init?.method === "PUT"),
    ).toBe(true);
  });

  it("TC-NOUS69_DEV-23 P205 保存時の 400 VALIDATION_ERROR でサーバーの fields のエラー文言を各入力欄の下に表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 200, body: settingsOkBody },
      "PUT /admin/api/settings": {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "入力の内容を確認してください",
            fields: {
              cycleMinutes: "15〜120 の整数で入力してください",
              promptVersion: "指定されたプロンプトの版が見つかりません",
            },
          },
        },
      },
    });
    renderApp("/settings");

    const cycleInput = await screen.findByLabelText("周期（分）");
    await userEvent.clear(cycleInput);
    await userEvent.type(cycleInput, "25");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("15〜120 の整数で入力してください")).toBeInTheDocument();
      expect(screen.getByText("指定されたプロンプトの版が見つかりません")).toBeInTheDocument();
    });
  });

  it("TC-NOUS69_DEV-24 P205 未保存の変更がある状態で画面移動すると ConfirmDialog を表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 200, body: settingsOkBody },
    });
    const { router } = renderApp("/settings");

    const cycleInput = await screen.findByLabelText("周期（分）");
    await userEvent.clear(cycleInput);
    await userEvent.type(cycleInput, "30");

    await userEvent.click(screen.getByRole("link", { name: "利用量と運用指標" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("変更が保存されていません。移動しますか");

    await userEvent.click(within(dialog).getByRole("button", { name: "移動する" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/metrics"));
  });
});
