import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { daily_metrics, daily_usage, world_settings, worlds } from "../../db/schema";
import { newUlid } from "../../lib/ids";
import { computeRates, dateRange, getDailyMetrics, getDailyMetricsView } from "./metricsService";

describe("metricsService", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
  });

  afterEach(() => {
    t.cleanup();
  });

  function seedRunningWorld(worldId = newUlid(clock.nowMs()), neuronsLimit = 9000): string {
    const iso = clock.nowIso();
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name: "世界 2026-10-20",
        state: "running",
        running_since: iso,
        created_at: iso,
        started_at: iso,
      })
      .run();

    t.db
      .insert(world_settings)
      .values({
        world_id: worldId,
        daily_neurons_limit: neuronsLimit,
        updated_at: iso,
      })
      .run();

    return worldId;
  }

  it("TC-NOUS65_DEV-10 dateRange は from から to までの UTC 日付配列を1日刻みで生成する", () => {
    const dates = dateRange("2026-10-18", "2026-10-20");
    expect(dates).toEqual(["2026-10-18", "2026-10-19", "2026-10-20"]);

    const single = dateRange("2026-10-20", "2026-10-20");
    expect(single).toEqual(["2026-10-20"]);

    const reversed = dateRange("2026-10-21", "2026-10-20");
    expect(reversed).toEqual([]);
  });

  it("TC-NOUS65_DEV-11 computeRates は replyRate, errorRate, actions を正しく計算し costJpy は 0 である", () => {
    const item = computeRates({
      usage_date: "2026-10-20",
      calls: 10,
      runs: 8,
      prompt_tokens: 1000,
      completion_tokens: 200,
      neurons: 50.5,
      posts: 4,
      replies: 6,
      replied_posts: 2,
      likes: 5,
      follows: 1,
      nones: 2,
      failures: 2,
    });

    expect(item.usageDate).toBe("2026-10-20");
    expect(item.costJpy).toBe(0);
    expect(item.actions).toBe(4 + 6 + 5 + 1); // posts + replies + likes + follows = 16
    expect(item.replyRate).toBe(2 / 4); // replied_posts / posts = 0.5
    expect(item.errorRate).toBe(2 / 8); // failures / runs = 0.25
  });

  it("TC-NOUS65_DEV-12 computeRates は posts=0 で replyRate=null、runs=0 で errorRate=null を返す", () => {
    const item = computeRates({
      usage_date: "2026-10-20",
      calls: 0,
      runs: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      neurons: 0,
      posts: 0,
      replies: 0,
      replied_posts: 0,
      likes: 0,
      follows: 0,
      nones: 0,
      failures: 0,
    });

    expect(item.replyRate).toBeNull();
    expect(item.errorRate).toBeNull();
    expect(item.actions).toBe(0);
  });

  it("TC-NOUS65_DEV-13 getDailyMetrics は daily_usage と daily_metrics を突き合わせ、データのない日を 0 で埋める", () => {
    const worldId = seedRunningWorld();

    t.db
      .insert(daily_usage)
      .values({
        usage_date: "2026-10-19",
        calls: 5,
        runs: 4,
        prompt_tokens: 500,
        completion_tokens: 100,
        neurons: 20.0,
      })
      .run();

    t.db
      .insert(daily_metrics)
      .values({
        world_id: worldId,
        usage_date: "2026-10-19",
        runs: 4,
        posts: 2,
        replies: 1,
        replied_posts: 1,
        likes: 3,
        follows: 0,
        nones: 1,
        failures: 0,
      })
      .run();

    const rows = getDailyMetrics(t.db, worldId, ["2026-10-18", "2026-10-19"]);
    expect(rows).toHaveLength(2);

    // 2026-10-18: データなし（すべて 0）
    expect(rows[0]).toEqual({
      usage_date: "2026-10-18",
      calls: 0,
      runs: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      neurons: 0,
      posts: 0,
      replies: 0,
      replied_posts: 0,
      likes: 0,
      follows: 0,
      nones: 0,
      failures: 0,
    });

    // 2026-10-19: 入力データ反映
    expect(rows[1]).toMatchObject({
      usage_date: "2026-10-19",
      calls: 5,
      runs: 4,
      neurons: 20.0,
      posts: 2,
      replies: 1,
      likes: 3,
    });
  });

  it("TC-NOUS65_DEV-14 getDailyMetricsView はクエリ省略時に今日を含む直近14日分の指標と設定上限を返す", () => {
    seedRunningWorld(undefined, 8500);
    const view = getDailyMetricsView(t.db, clock, {});

    expect(view.freeTierNeurons).toBe(10000);
    expect(view.neuronsLimit).toBe(8500);
    expect(view.items).toHaveLength(14);
    // TEST_NOW は 2026-10-20 なので、2026-10-07 から 2026-10-20 まで
    expect(view.items[0]?.usageDate).toBe("2026-10-07");
    expect(view.items[13]?.usageDate).toBe("2026-10-20");
  });

  it("TC-NOUS65_DEV-15 getDailyMetricsView は from ≦ to の指定期間の指標を正しく返す", () => {
    seedRunningWorld();
    const view = getDailyMetricsView(t.db, clock, { from: "2026-10-01", to: "2026-10-03" });
    expect(view.items).toHaveLength(3);
    expect(view.items.map((i) => i.usageDate)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("TC-NOUS65_DEV-16 getDailyMetricsView は from > to、90日超、不正な日付に 400 VALIDATION_ERROR を投げる", () => {
    seedRunningWorld();

    // from > to
    expect(() => getDailyMetricsView(t.db, clock, { from: "2026-10-10", to: "2026-10-05" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );

    // 91 日間
    expect(() => getDailyMetricsView(t.db, clock, { from: "2026-01-01", to: "2026-04-02" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );

    // 不正な日付文字列
    expect(() => getDailyMetricsView(t.db, clock, { from: "2026-02-31", to: "2026-03-01" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
