// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_generationConfig.json
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadGenerationConfig, parseGenerationConfig } from "./generationConfig";

function validConfig() {
  return {
    participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
    candidateCount: 2,
    weights: { post: 3.0, reply: 3.0, like: 2.5, follow: 1.5, unfollow: 0.5 },
    recentPenalty: 0.4,
    firstPersonRules: [{ keywords: ["丁寧語"], mismatch: ["俺"] }],
  };
}

function writeTemp(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "nous102-")), "generation.json");
  writeFileSync(path, content);
  return path;
}

/** fn が投げた例外を返す。投げなければ失敗にする */
function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("例外が投げられませんでした");
}

describe("generationConfig（単体テスト）", () => {
  it("TC-UT_CFG-001 減点の境界値（0 と 1）は通る", () => {
    const zero = parseGenerationConfig({ ...validConfig(), recentPenalty: 0 });
    const one = parseGenerationConfig({ ...validConfig(), recentPenalty: 1 });

    expect(zero.recentPenalty).toBe(0);
    expect(one.recentPenalty).toBe(1);
  });

  it("TC-UT_CFG-002 一人称の表は空の配列でも通る", () => {
    const config = parseGenerationConfig({ ...validConfig(), firstPersonRules: [] });

    expect(config.firstPersonRules).toEqual([]);
  });

  it.each([
    ["減点が負", { recentPenalty: -0.01 }],
    ["重みに知らない種類がある", { weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5, repost: 1 } }],
    ["活動頻度に 6 がある", { participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9, "6": 1 } }],
    ["確率が文字列", { participation: { "1": "0.3", "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 } }],
    ["候補の数が文字列", { candidateCount: "2" }],
    ["一人称の表の合わない一人称が空", { firstPersonRules: [{ keywords: ["丁寧語"], mismatch: [] }] }],
    ["一人称の表に空の文字列がある", { firstPersonRules: [{ keywords: [""], mismatch: ["俺"] }] }],
    ["一人称の表に知らない項目がある", { firstPersonRules: [{ keywords: ["丁寧語"], mismatch: ["俺"], note: "x" }] }],
  ])("TC-UT_CFG-003 不正な値は ConfigError（%s）", (_label, patch) => {
    const value = { ...validConfig(), ...patch };

    expect(() => parseGenerationConfig(value)).toThrow(ConfigError);
  });

  it.each([
    ["null", null],
    ["配列", []],
    ["文字列", "config"],
  ])("TC-UT_CFG-004 全体がオブジェクトでなければ ConfigError で、場所は (root)（%s）", (_label, value) => {
    const err = catchError(() => parseGenerationConfig(value));

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("(root)");
  });

  it("TC-UT_CFG-005 出どころを省くと文言に config/generation.json が入り、原因の ZodError を cause に残す", () => {
    const err = catchError(() => parseGenerationConfig({ ...validConfig(), candidateCount: 9 }));

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("config/generation.json");
    expect(err.cause).toBeDefined();
  });

  it("TC-UT_CFG-006 ファイルが無いときは、パスを文言に入れ、元の例外を cause に残す", () => {
    const missing = join(tmpdir(), "nous102-missing", "generation.json");

    const err = catchError(() => loadGenerationConfig(missing));

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain(missing);
    expect(err.cause).toBeDefined();
  });

  it("TC-UT_CFG-007 JSON として読めないときは、パスを文言に入れ、SyntaxError を cause に残す", () => {
    const broken = writeTemp("{ not json");

    const err = catchError(() => loadGenerationConfig(broken));

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain(broken);
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });

  it("TC-UT_CFG-008 空のファイルは JSON として読めず ConfigError", () => {
    const empty = writeTemp("");

    expect(() => loadGenerationConfig(empty)).toThrow(ConfigError);
  });

  it("TC-UT_CFG-009 ファイルの値が不正なときは、文言の出どころがファイルのパスになる", () => {
    const path = writeTemp(JSON.stringify({ ...validConfig(), recentPenalty: 2 }));

    const err = catchError(() => loadGenerationConfig(path));

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain(path);
    expect(err.message).toContain("recentPenalty");
  });
});
