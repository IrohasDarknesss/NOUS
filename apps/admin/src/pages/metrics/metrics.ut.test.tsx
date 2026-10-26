// 単体テスト（NOUS-107）。観点表は docs/test/unit/NOUS-107/観点表_P206.json
import type { DailyMetricsItem, MetricsView } from "@nous/shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colors } from "../../shared/theme";
import { mockFetch, sessionOk, worldOk, type MockResponse } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { METRICS_FETCH_FAILED_MESSAGE, METRICS_INITIAL_ERROR_MESSAGE } from "../MetricsPage";
import { ActivityChart } from "./ActivityChart";
import { DateRangePicker, presetRange, todayUtcDate, validateRange } from "./DateRangePicker";
import { MetricsTable, buildFailedLogsPath, formatRate } from "./MetricsTable";
import { TodaySummary } from "./TodaySummary";
import { UsageChart } from "./UsageChart";

// Recharts は jsdom では寸法が 0 になり描画されないため、受け取った props を data 属性に写す差し替えにする
vi.mock("recharts", async () => {
  const React = await import("react");
  const stub =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement("div", { "data-chart": name, "data-props": JSON.stringify(props) }, children);
  return {
    ResponsiveContainer: stub("ResponsiveContainer"),
    BarChart: stub("BarChart"),
    ComposedChart: stub("ComposedChart"),
    Bar: stub("Bar"),
    Line: stub("Line"),
    XAxis: stub("XAxis"),
    YAxis: stub("YAxis"),
    CartesianGrid: stub("CartesianGrid"),
    Tooltip: stub("Tooltip"),
    Legend: stub("Legend"),
    ReferenceLine: stub("ReferenceLine"),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function item(usageDate: string, overrides: Partial<DailyMetricsItem> = {}): DailyMetricsItem {
  return {
    usageDate,
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
    ...overrides,
  };
}

function view(items: DailyMetricsItem[]): MetricsView {
  return { freeTierNeurons: 10000, neuronsLimit: 9500, items };
}

/** 差し替えた Recharts の部品が受け取った props */
function chartProps(container: HTMLElement, name: string): Record<string, unknown>[] {
  return [...container.querySelectorAll(`[data-chart="${name}"]`)].map(
    (el) => JSON.parse(el.getAttribute("data-props") ?? "{}") as Record<string, unknown>,
  );
}

function metricsCalls(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input)).filter((u) => u.startsWith("/admin/api/metrics/daily"));
}

/** 指標の API の応答をテストの途中で替えられるようにする */
function mockMetrics(initial: MockResponse) {
  let current = initial;
  const fetchMock = mockFetch({
    "GET /admin/api/session": sessionOk,
    "GET /admin/api/world": worldOk,
    "GET /admin/api/metrics/daily": () => current,
  });
  return {
    fetchMock,
    respond: (next: MockResponse) => {
      current = next;
    },
  };
}

const SERVER_ERROR: MockResponse = { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } };

describe("P206 利用量・運用指標（単体テスト）", () => {
  it("TC-UT_P206-001 validateRange は開始か終了が空なら null を返す", () => {
    expect(validateRange("", "2026-10-20")).toBeNull();
    expect(validateRange("2026-10-20", "")).toBeNull();
  });

  it("TC-UT_P206-002 validateRange は日付として読めない値なら null を返す", () => {
    expect(validateRange("2026-13-40", "2026-10-20")).toBeNull();
  });

  it("TC-UT_P206-003 presetRange はうるう日をまたいでも日数どおりの開始日を返す", () => {
    const now = new Date("2028-03-01T00:00:00.000Z");

    expect(presetRange(7, now)).toEqual({ from: "2028-02-24", to: "2028-03-01" });
  });

  it("TC-UT_P206-004 今日の日付は UTC で決まり、00:00:00.000Z（日本時間 9:00）で切り替わる", () => {
    expect(todayUtcDate(new Date("2026-10-20T23:59:59.999Z"))).toBe("2026-10-20");
    expect(todayUtcDate(new Date("2026-10-21T00:00:00.000Z"))).toBe("2026-10-21");
    expect(presetRange(14, new Date("2026-10-20T23:59:59.999Z")).to).toBe("2026-10-20");
  });

  it("TC-UT_P206-005 formatRate は 0.05 を 5.0%、1 を 100.0% にし、0.05% 未満は 0.0% に丸める", () => {
    expect(formatRate(0.05)).toBe("5.0%");
    expect(formatRate(1)).toBe("100.0%");
    expect(formatRate(0.00049)).toBe("0.0%");
  });

  it("TC-UT_P206-006 月末の利用日の失敗ログの URL は、翌月 1 日の 00:00Z までにする", () => {
    const params = new URLSearchParams(buildFailedLogsPath("2026-10-31").split("?")[1]);

    expect(params.get("from")).toBe("2026-10-31T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("TC-UT_P206-007 エラー率がちょうど 5% なら赤にせず、5% を超えると赤にする", () => {
    render(
      <MetricsTable
        items={[item("2026-10-20", { errorRate: 0.05 }), item("2026-10-21", { errorRate: 0.051 })]}
        onErrorRateClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "5.0%" })).toHaveStyle({ color: colors.primary });
    expect(screen.getByRole("button", { name: "5.1%" })).toHaveStyle({ color: colors.danger });
  });

  it("TC-UT_P206-008 エラー率が null（実行 0 回）の日は「―」で、赤にしない", () => {
    const onClick = vi.fn();
    render(<MetricsTable items={[item("2026-10-20", { errorRate: null, runs: 0 })]} onErrorRateClick={onClick} />);

    const button = screen.getByRole("button", { name: "―" });
    fireEvent.click(button);

    expect(button).toHaveStyle({ color: colors.primary });
    expect(onClick).toHaveBeenCalledWith("2026-10-20");
  });

  it("TC-UT_P206-009 日別の表は、トークンを 3 桁区切り、Neurons を小数 1 桁、概算費用を 0 円で出す", () => {
    render(
      <MetricsTable
        items={[item("2026-10-20", { promptTokens: 380000, completionTokens: 18000, neurons: 1234 })]}
        onErrorRateClick={vi.fn()}
      />,
    );

    expect(screen.getByText("380,000")).toBeInTheDocument();
    expect(screen.getByText("18,000")).toBeInTheDocument();
    expect(screen.getByText("1,234.0")).toBeInTheDocument();
    expect(screen.getByText("0 円")).toBeInTheDocument();
  });

  it("TC-UT_P206-010 日別の表は 0 件なら「この期間のデータはありません」を出す", () => {
    render(<MetricsTable items={[]} onErrorRateClick={vi.fn()} />);

    expect(screen.getByText("この期間のデータはありません")).toBeInTheDocument();
  });

  it("TC-UT_P206-011 今日の要約は、今日の値が無ければ 0 / 無料枠・0 回・0 円を出す", () => {
    render(<TodaySummary today={null} />);

    expect(screen.getByTestId("today-neurons")).toHaveTextContent("0 / 10,000");
    expect(screen.getByTestId("today-calls")).toHaveTextContent("0 回");
    expect(screen.getByTestId("today-cost")).toHaveTextContent("0 円");
  });

  it("TC-UT_P206-012 今日の要約は、Neurons を小数 1 桁まで、呼び出しを 3 桁区切りで出し、無料枠の値を使う", () => {
    render(<TodaySummary today={item("2026-10-20", { neurons: 2104.56, calls: 1234 })} freeTier={12000} />);

    expect(screen.getByTestId("today-neurons")).toHaveTextContent("2,104.6 / 12,000");
    expect(screen.getByTestId("today-calls")).toHaveTextContent("1,234 回");
  });

  it("TC-UT_P206-013 MetricsPage は、期間の途中の日が今日なら、その日の値を今日の要約に出す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-20T03:00:00.000Z") });
    mockMetrics({
      status: 200,
      body: view([
        item("2026-10-19", { neurons: 100 }),
        item("2026-10-20", { neurons: 2104.5, calls: 132 }),
        item("2026-10-21", { neurons: 300 }),
      ]),
    });

    renderApp("/metrics?from=2026-10-19&to=2026-10-21");

    await waitFor(() => expect(screen.getByTestId("today-neurons")).toHaveTextContent("2,104.5 / 10,000"));
    expect(screen.getByTestId("today-calls")).toHaveTextContent("132 回");
  });

  it("TC-UT_P206-014 MetricsPage は、期間に今日が含まれなければ、今日の要約を 0 にする", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-22T03:00:00.000Z") });
    mockMetrics({ status: 200, body: view([item("2026-10-20", { neurons: 4210.5 }), item("2026-10-21")]) });

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText("2026-10-21")).toBeInTheDocument();
    expect(screen.getByTestId("today-neurons")).toHaveTextContent("0 / 10,000");
    expect(screen.getByTestId("today-calls")).toHaveTextContent("0 回");
  });

  it("TC-UT_P206-015 MetricsPage は、期間に今日が含まれても今日の行が無ければ、前の日の値を出さず 0 にする", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-21T03:00:00.000Z") });
    mockMetrics({ status: 200, body: view([item("2026-10-20", { neurons: 4210.5 })]) });

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    expect(screen.getByTestId("today-neurons")).toHaveTextContent("0 / 10,000");
  });

  it("TC-UT_P206-016 MetricsPage は、URL に期間が無ければ今日までの 14 日で取得する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-21T03:00:00.000Z") });
    const { fetchMock } = mockMetrics({ status: 200, body: view([]) });

    renderApp("/metrics");

    await waitFor(() => expect(metricsCalls(fetchMock).length).toBeGreaterThan(0));
    expect(metricsCalls(fetchMock)[0]).toBe("/admin/api/metrics/daily?from=2026-10-08&to=2026-10-21");
  });

  it("TC-UT_P206-017 MetricsPage は、URL の期間が誤っていれば（開始が終了より後）既定の 14 日で取得する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-21T03:00:00.000Z") });
    const { fetchMock } = mockMetrics({ status: 200, body: view([]) });

    renderApp("/metrics?from=2026-10-21&to=2026-10-20");

    await waitFor(() => expect(metricsCalls(fetchMock).length).toBeGreaterThan(0));
    expect(metricsCalls(fetchMock)[0]).toBe("/admin/api/metrics/daily?from=2026-10-08&to=2026-10-21");
  });

  it("TC-UT_P206-018 期間の開始を終了より後にすると、入力欄の下に文言を出し、期間を変えない", () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-10-20" to="2026-10-21" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "2026-10-22" } });

    expect(screen.getByText("開始日は終了日より前にしてください")).toBeInTheDocument();
    expect(screen.getByLabelText("期間の開始")).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("TC-UT_P206-019 期間が 91 日なら文言を出して期間を変えず、90 日なら期間を変える", () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-10-01" to="2026-10-20" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "2026-07-22" } });
    expect(screen.getByText("期間は 90 日以内にしてください")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "2026-07-23" } });
    expect(screen.queryByText("期間は 90 日以内にしてください")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ from: "2026-07-23", to: "2026-10-20" });
  });

  it("TC-UT_P206-020 期間の開始を空にしたときは、文言を出さず、期間も変えない", () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-10-20" to="2026-10-21" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("期間の開始"), { target: { value: "" } });

    expect(screen.queryByText("開始日は終了日より前にしてください")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("TC-UT_P206-021 「直近 7 日」を押すと、UTC の今日までの 7 日に変える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-21T03:00:00.000Z") });
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-10-01" to="2026-10-10" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "直近 7 日" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-15", to: "2026-10-21" });
  });

  it("TC-UT_P206-022 外から渡された期間が変わると入力を合わせ、誤りがあれば文言を出す", () => {
    const { rerender } = render(<DateRangePicker from="2026-10-20" to="2026-10-21" onChange={vi.fn()} />);

    rerender(<DateRangePicker from="2026-10-22" to="2026-10-21" onChange={vi.fn()} />);

    expect(screen.getByLabelText("期間の開始")).toHaveValue("2026-10-22");
    expect(screen.getByText("開始日は終了日より前にしてください")).toBeInTheDocument();
  });

  it("TC-UT_P206-023 日付が UTC の利用日であることを「日本時間 9:00 に切り替わります」と添える", () => {
    render(<DateRangePicker from="2026-10-20" to="2026-10-21" onChange={vi.fn()} />);

    expect(screen.getByText("日本時間 9:00 に切り替わります")).toBeInTheDocument();
  });

  it("TC-UT_P206-024 利用量のグラフは、日別の Neurons の棒と、無料枠・日次上限の横線を引く", () => {
    const { container } = render(
      <UsageChart items={[item("2026-10-20", { neurons: 4210.5 })]} freeTier={10000} limit={9500} />,
    );

    const lines = chartProps(container, "ReferenceLine");
    expect(lines).toEqual([
      expect.objectContaining({ y: 10000, label: "無料枠 10,000" }),
      expect.objectContaining({ y: 9500, label: "日次上限 9,500" }),
    ]);
    expect(chartProps(container, "BarChart")[0]!.data).toEqual([{ usageDate: "2026-10-20", neurons: 4210.5 }]);
    expect(chartProps(container, "YAxis")[0]!.domain).toEqual([0, 10000]);
  });

  it("TC-UT_P206-025 日次上限が無ければ横線は無料枠だけで、上限が無料枠より大きければ縦軸を上限まで取る", () => {
    const noLimit = render(<UsageChart items={[]} freeTier={10000} />);
    expect(chartProps(noLimit.container, "ReferenceLine")).toHaveLength(1);
    noLimit.unmount();

    const big = render(<UsageChart items={[]} freeTier={10000} limit={12000} />);
    expect(chartProps(big.container, "YAxis")[0]!.domain).toEqual([0, 12000]);
  });

  it("TC-UT_P206-026 活発さのグラフは投稿数の棒と、応答率を百分率の小数 1 桁にした線（null はそのまま）にする", () => {
    const { container } = render(
      <ActivityChart
        items={[
          item("2026-10-20", { posts: 61, replyRate: 0.6234 }),
          item("2026-10-21", { posts: 0, replyRate: null }),
        ]}
      />,
    );

    expect(chartProps(container, "ComposedChart")[0]!.data).toEqual([
      { usageDate: "2026-10-20", posts: 61, replyRatePercent: 62.3 },
      { usageDate: "2026-10-21", posts: 0, replyRatePercent: null },
    ]);
    expect(chartProps(container, "ReferenceLine")).toHaveLength(0);
  });

  it("TC-UT_P206-027 最初の取得が 500 なら「指標を取得できませんでした」をポップアップで出す", async () => {
    mockMetrics(SERVER_ERROR);

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText(METRICS_INITIAL_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it("TC-UT_P206-028 最初の取得が通信エラーでも「指標を取得できませんでした」をポップアップで出す", async () => {
    const base = mockFetch({ "GET /admin/api/session": sessionOk, "GET /admin/api/world": worldOk });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("/admin/api/metrics")) throw new TypeError("Failed to fetch");
        return base(input, init);
      }),
    );

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText(METRICS_INITIAL_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it("TC-UT_P206-029 取得が 401 ならセッション切れのポップアップを出す", async () => {
    mockMetrics({ status: 401, body: { error: { code: "ADMIN_UNAUTHORIZED", message: "x" } } });

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText("ログインの有効期限が切れました。もう一度ログインしてください")).toBeInTheDocument();
    expect(screen.queryByText(METRICS_INITIAL_ERROR_MESSAGE)).toBeNull();
  });

  it("TC-UT_P206-030 成功の後の再取得が 2 回続けて失敗しても上部の表示は出さず、3 回目で「最新の指標を取得できていません」を出す", async () => {
    const { respond } = mockMetrics({ status: 200, body: view([item("2026-10-20")]) });
    const { queryClient } = renderApp("/metrics?from=2026-10-20&to=2026-10-21");
    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    respond(SERVER_ERROR);
    const refetch = () =>
      act(async () => {
        await queryClient.refetchQueries({ queryKey: ["admin", "metrics", "2026-10-20", "2026-10-21"] });
      });

    await refetch();
    await refetch();
    expect(screen.queryByText(METRICS_FETCH_FAILED_MESSAGE)).toBeNull();
    await refetch();

    expect(await screen.findByText(METRICS_FETCH_FAILED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(METRICS_INITIAL_ERROR_MESSAGE)).toBeNull();
  });

  it("TC-UT_P206-031 上部の表示を出した後に再取得が成功すると、表示を消す", async () => {
    const { respond } = mockMetrics({ status: 200, body: view([item("2026-10-20")]) });
    const { queryClient } = renderApp("/metrics?from=2026-10-20&to=2026-10-21");
    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    const refetch = () =>
      act(async () => {
        await queryClient.refetchQueries({ queryKey: ["admin", "metrics", "2026-10-20", "2026-10-21"] });
      });
    respond(SERVER_ERROR);
    await refetch();
    await refetch();
    await refetch();
    expect(await screen.findByText(METRICS_FETCH_FAILED_MESSAGE)).toBeInTheDocument();

    respond({ status: 200, body: view([item("2026-10-20")]) });
    await refetch();

    await waitFor(() => expect(screen.queryByText(METRICS_FETCH_FAILED_MESSAGE)).toBeNull());
  });

  it("TC-UT_P206-032 期間の終了が今日なら 30 秒ごとに取り直し、今日でなければ取り直さない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-21T03:00:00.000Z") });
    const today = mockMetrics({ status: 200, body: view([item("2026-10-21")]) });
    const first = renderApp("/metrics?from=2026-10-20&to=2026-10-21");
    await waitFor(() => expect(metricsCalls(today.fetchMock).length).toBeGreaterThan(0));
    const todayBefore = metricsCalls(today.fetchMock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await waitFor(() => expect(metricsCalls(today.fetchMock).length).toBeGreaterThan(todayBefore));
    first.unmount();

    const past = mockMetrics({ status: 200, body: view([item("2026-10-19")]) });
    renderApp("/metrics?from=2026-10-19&to=2026-10-20");
    await waitFor(() => expect(metricsCalls(past.fetchMock).length).toBeGreaterThan(0));
    const pastBefore = metricsCalls(past.fetchMock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(metricsCalls(past.fetchMock)).toHaveLength(pastBefore);
  });

  it("TC-UT_P206-033 取得が 400 なら、サーバーの文言を期間の入力欄の下に出し、指標のポップアップは出さない", async () => {
    mockMetrics({
      status: 400,
      body: { error: { code: "VALIDATION_ERROR", message: "期間の指定が正しくありません" } },
    });

    renderApp("/metrics?from=2026-10-20&to=2026-10-21");

    expect(await screen.findByText("期間の指定が正しくありません")).toBeInTheDocument();
    expect(screen.queryByText(METRICS_INITIAL_ERROR_MESSAGE)).toBeNull();
  });
});
