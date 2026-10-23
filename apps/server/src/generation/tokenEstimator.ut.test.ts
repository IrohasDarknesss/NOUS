// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_promptBuilder_tokenEstimator.json
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { agents, generation_events, worlds } from "../db/schema";
import { DEFAULT_TOKEN_RATIO, countChars, estimateTokens, loadTokenRatio } from "./tokenEstimator";

const NOW = "2026-10-21T09:00:00.000Z";
const WORLD_ID = "01JB0000000000000000000001";
const AGENT_ID = "01JB0000000000000000000002";

describe("tokenEstimator（単体テスト）", () => {
  it("TC-UT_PRM-001 メッセージが無い・本文が空なら 0", () => {
    expect(estimateTokens([], 0.6)).toBe(0);
    expect(estimateTokens([{ role: "user", content: "" }], 0.9)).toBe(0);
  });

  it("TC-UT_PRM-002 実測の比が 0.6 未満でも 0.6 を下限にする", () => {
    const messages = [{ role: "user" as const, content: "x".repeat(10) }];

    expect(estimateTokens(messages, 0)).toBe(6);
  });

  it("TC-UT_PRM-003 端数は切り上げる（1 字 × 0.6 = 1）", () => {
    const messages = [{ role: "user" as const, content: "x" }];

    expect(estimateTokens(messages, 0.6)).toBe(1);
  });

  it("TC-UT_PRM-004 空の文字列の文字数は 0", () => {
    expect(countChars("")).toBe(0);
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

    /** 成功した生成イベントを、後に入れたものほど新しくなるように入れる */
    function addEvent(
      promptTokens: number,
      promptChars: number,
      opts: { status?: "succeeded" | "failed"; promptText?: string | null } = {},
    ): void {
      n++;
      t.db
        .insert(generation_events)
        .values({
          event_id: `01JB${String(n).padStart(22, "0")}`,
          world_id: WORLD_ID,
          agent_id: AGENT_ID,
          cycle_no: 1,
          cycle_seed: 1,
          status: opts.status ?? "succeeded",
          decided_by: "llm",
          action: "post",
          failure_kind: opts.status === "failed" ? "server_error" : null,
          prompt_text: opts.promptText === undefined ? "x".repeat(promptChars) : opts.promptText,
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

    it("TC-UT_PRM-005 ちょうど 20 件なら実測の比を使う", () => {
      for (let i = 0; i < 20; i++) addEvent(90, 100);

      expect(loadTokenRatio(t.db)).toBeCloseTo(0.9);
    });

    it("TC-UT_PRM-006 生成イベントが 1 件も無ければ 0.6", () => {
      expect(loadTokenRatio(t.db)).toBe(DEFAULT_TOKEN_RATIO);
    });

    it("TC-UT_PRM-007 prompt_tokens が 0 の行は平均にも件数にも入れない", () => {
      for (let i = 0; i < 20; i++) addEvent(70, 100);
      for (let i = 0; i < 5; i++) addEvent(0, 100);

      expect(loadTokenRatio(t.db)).toBeCloseTo(0.7);
    });

    it("TC-UT_PRM-008 失敗した生成と、prompt_text の無い行・空の行は数えない", () => {
      for (let i = 0; i < 19; i++) addEvent(70, 100);
      addEvent(90, 100, { status: "failed" });
      addEvent(90, 0, { promptText: null });
      addEvent(90, 0, { promptText: "" });

      expect(loadTokenRatio(t.db)).toBe(DEFAULT_TOKEN_RATIO);
    });

    it("TC-UT_PRM-009 直近 50 件の中で使える行が 20 件未満なら、それより古い行があっても 0.6", () => {
      for (let i = 0; i < 30; i++) addEvent(70, 100);
      for (let i = 0; i < 19; i++) addEvent(80, 100);
      for (let i = 0; i < 31; i++) addEvent(0, 100);

      expect(loadTokenRatio(t.db)).toBe(DEFAULT_TOKEN_RATIO);
    });
  });
});
