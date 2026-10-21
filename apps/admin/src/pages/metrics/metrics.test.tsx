// P206 利用量・運用指標の単体・画面テスト（FE 詳細設計 admin_agents_logs 4章・6章）
import type { DailyMetricsItem, MetricsView } from "@nous/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colors } from "../../shared/theme";
import { mockFetch, sessionOk, worldOk } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { presetRange, validateRange } from "./DateRangePicker";
import { buildFailedLogsPath, formatRate, openFailedLogs } from "./MetricsTable";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sampleItemLowError: DailyMetricsItem = {
  usageDate: "2026-10-20",
  calls: 268,
  runs: 260,
  promptTokens: 380000,
  completionTokens: 18000,
  neurons: 4210.5,
  costJpy: 0,
  posts: 61,
  replies: 88,
  replyRate: 0.623,
  likes: 54,
  follows: 9,
  nones: 140,
  actions: 212,
  failures: 3,
  errorRate: 0.0115,
};

const sampleItemHighError: DailyMetricsItem = {
  ...sampleItemLowError,
  usageDate: "2026-10-21",
  failures: 20,
  errorRate: 0.0769,
};

const sampleMetrics: MetricsView = {
  freeTierNeurons: 10000,
  neuronsLimit: 9500,
  items: [sampleItemLowError, sampleItemHighError],
};

describe("P206 利用量・運用指標", () => {
  it("TC-NOUS71_DEV-01 validateRange：開始が終了より後ならエラー、91 日以上ならエラー、90 日以内なら null", () => {
    expect(validateRange("2026-10-21", "2026-10-20")).toBe("開始日は終了日より前にしてください");
    expect(validateRange("2026-07-01", "2026-09-29")).toBe("期間は 90 日以内にしてください");
    expect(validateRange("2026-07-01", "2026-09-28")).toBeNull();
    expect(validateRange("2026-10-20", "2026-10-20")).toBeNull();
  });

  it("TC-NOUS71_DEV-02 presetRange：7・14・30 日の期間を UTC の日付で返す", () => {
    const now = new Date("2026-10-20T05:00:00.000Z");
    expect(presetRange(7, now)).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(presetRange(14, now)).toEqual({ from: "2026-10-07", to: "2026-10-20" });
    expect(presetRange(30, now)).toEqual({ from: "2026-09-21", to: "2026-10-20" });
  });

  it("TC-NOUS71_DEV-03 formatRate：null は「―」、数値は百分率の小数 1 桁にする", () => {
    expect(formatRate(null)).toBe("―");
    expect(formatRate(0)).toBe("0.0%");
    expect(formatRate(0.6234)).toBe("62.3%");
    expect(formatRate(0.0115)).toBe("1.1%");
  });

  it("TC-NOUS71_DEV-04 openFailedLogs：利用日の 00:00Z から翌日の 00:00Z までの失敗ログ URL へ遷移する", () => {
    const navigate = vi.fn();
    openFailedLogs("2026-10-20", navigate);
    expect(buildFailedLogsPath("2026-10-20")).toBe(
      "/generations?status=failed&from=2026-10-20T00%3A00%3A00.000Z&to=2026-10-21T00%3A00%3A00.000Z",
    );
    expect(navigate).toHaveBeenCalledWith(
      "/generations?status=failed&from=2026-10-20T00%3A00%3A00.000Z&to=2026-10-21T00%3A00%3A00.000Z",
    );
  });

  it("TC-NOUS71_DEV-05 MetricsPage：今日の要約・グラフ・日別の表を描画し、エラー率 5% 超を赤で表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/metrics/daily": { status: 200, body: sampleMetrics },
    });
    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    expect(screen.getByText("2026-10-21")).toBeInTheDocument();
    expect(screen.getByTestId("today-cost")).toHaveTextContent("0 円");
    expect(screen.getByRole("region", { name: "利用量のグラフ" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "活発さと応答率のグラフ" })).toBeInTheDocument();

    const lowBtn = screen.getByRole("button", { name: "1.1%" });
    const highBtn = screen.getByRole("button", { name: "7.7%" });
    expect(lowBtn).toHaveStyle({ color: colors.primary });
    expect(highBtn).toHaveStyle({ color: colors.danger });
  });

  it("TC-NOUS71_DEV-06 MetricsPage：エラー率のクリックで P207 に status=failed と期間を付けて遷移する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/metrics/daily": { status: 200, body: sampleMetrics },
      "GET /admin/api/agents": { status: 200, body: { items: [], worldState: "running" } },
      "GET /admin/api/generations": { status: 200, body: { items: [], nextCursor: null } },
    });
    const { router } = renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    const highBtn = await screen.findByRole("button", { name: "7.7%" });
    await userEvent.click(highBtn);

    await waitFor(() => expect(router.state.location.pathname).toBe("/generations"));
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("status")).toBe("failed");
    expect(params.get("from")).toBe("2026-10-21T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-10-22T00:00:00.000Z");
  });
});
