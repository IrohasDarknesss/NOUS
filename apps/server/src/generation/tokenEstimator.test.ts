import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { agents, generation_events, worlds } from "../db/schema";
import { DEFAULT_TOKEN_RATIO, countChars, estimateTokens, loadTokenRatio } from "./tokenEstimator";

const NOW = "2026-10-21T09:00:00.000Z";
const WORLD_ID = "01JB0000000000000000000001";
const AGENT_ID = "01JB0000000000000000000002";

describe("estimateTokens", () => {
  it("TC-NOUS61_DEV-31 全メッセージの文字数に 0.6 を掛けて切り上げる", () => {
    const messages = [
      { role: "system" as const, content: "あ".repeat(10) },
      { role: "user" as const, content: "b".repeat(5) },
    ];
    expect(estimateTokens(messages, 0.5)).toBe(9);
    expect(estimateTokens(messages, 0.6)).toBe(9);
  });

  it("TC-NOUS61_DEV-32 実測の比が 0.6 を超えればその比を使う", () => {
    expect(estimateTokens([{ role: "user", content: "x".repeat(100) }], 0.75)).toBe(75);
  });

  it("TC-NOUS61_DEV-33 文字数はコードポイントで数える（サロゲートペアは 1 字）", () => {
    expect(countChars("𠮷野家")).toBe(3);
    expect(estimateTokens([{ role: "user", content: "𠮷".repeat(10) }], 0.6)).toBe(6);
  });
});

describe("loadTokenRatio", () => {
  let t: TestDb;
  let n = 0;

  beforeEach(() => {
    t = createTestDb();
    n = 0;
    t.db.insert(worlds).values({ world_id: WORLD_ID, name: "w", created_at: NOW }).run();
    t.db
      .insert(agents)
      .values({
        agent_id: AGENT_ID,
        world_id: WORLD_ID,
        handle: "minato",
        display_name: "ミナト",
        interests: "i",
        topics: "t",
        personality: "p",
        values_text: "v",
        stance: "s",
        created_at: NOW,
        updated_at: NOW,
      })
      .run();
  });

  afterEach(() => t.cleanup());

  function addEvent(promptTokens: number, promptChars: number, decidedBy: "llm" | "gate" = "llm"): void {
    n++;
    t.db
      .insert(generation_events)
      .values({
        event_id: `01JB${String(n).padStart(22, "0")}`,
        world_id: WORLD_ID,
        agent_id: AGENT_ID,
        cycle_no: 1,
        cycle_seed: 1,
        status: "succeeded",
        decided_by: decidedBy,
        action: "post",
        prompt_text: "x".repeat(promptChars),
        prompt_tokens: promptTokens,
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: n,
        started_at: new Date(Date.parse(NOW) + n * 1000).toISOString(),
        finished_at: NOW,
        usage_date: "2026-10-21",
      })
      .run();
  }

  it("TC-NOUS61_DEV-34 成功した LLM の生成が 20 件未満なら 0.6", () => {
    for (let i = 0; i < 19; i++) addEvent(80, 100);
    expect(loadTokenRatio(t.db)).toBe(DEFAULT_TOKEN_RATIO);
  });

  it("TC-NOUS61_DEV-35 20 件以上なら prompt_tokens ÷ 文字数の平均", () => {
    for (let i = 0; i < 20; i++) addEvent(70, 100);
    expect(loadTokenRatio(t.db)).toBeCloseTo(0.7);
  });

  it("TC-NOUS61_DEV-36 直近 50 件だけを使い、参加の判定（gate）の行は数えない", () => {
    for (let i = 0; i < 30; i++) addEvent(50, 100);
    for (let i = 0; i < 50; i++) addEvent(80, 100);
    for (let i = 0; i < 5; i++) addEvent(0, 100, "gate");
    expect(loadTokenRatio(t.db)).toBeCloseTo(0.8);
  });
});
