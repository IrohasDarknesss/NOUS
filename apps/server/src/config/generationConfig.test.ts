import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadGenerationConfig, parseGenerationConfig } from "./generationConfig";

const repoConfigPath = fileURLToPath(new URL("../../../../config/generation.json", import.meta.url));

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
  const path = join(mkdtempSync(join(tmpdir(), "nous48-")), "generation.json");
  writeFileSync(path, content);
  return path;
}

describe("generationConfig", () => {
  it("TC-NOUS48_DEV-11 リポジトリの config/generation.json を読める", () => {
    const config = loadGenerationConfig(repoConfigPath);
    expect(config.participation["3"]).toBe(0.6);
    expect(config.candidateCount).toBe(2);
    expect(config.weights.follow).toBe(1.5);
    expect(config.recentPenalty).toBe(0.4);
    expect(config.firstPersonRules).toHaveLength(3);
  });

  it("TC-NOUS48_DEV-12 正しい値はそのまま返す", () => {
    expect(parseGenerationConfig(validConfig())).toEqual(validConfig());
  });

  it("TC-NOUS48_DEV-13 境界値（確率 0 と 1、重み 0、候補の数 2 と 4）は通る", () => {
    const config = validConfig();
    config.participation["1"] = 0;
    config.participation["5"] = 1;
    config.weights.unfollow = 0;
    expect(() => parseGenerationConfig(config)).not.toThrow();
    expect(() => parseGenerationConfig({ ...config, candidateCount: 4 })).not.toThrow();
  });

  it.each([
    [
      "確率が 1 を超える",
      (c: ReturnType<typeof validConfig>) => ({ ...c, participation: { ...c.participation, "5": 1.01 } }),
    ],
    ["確率が負", (c: ReturnType<typeof validConfig>) => ({ ...c, participation: { ...c.participation, "1": -0.1 } })],
    ["活動頻度の確率が欠けている", (c: ReturnType<typeof validConfig>) => ({ ...c, participation: { "1": 0.3 } })],
    ["重みが負", (c: ReturnType<typeof validConfig>) => ({ ...c, weights: { ...c.weights, like: -1 } })],
    ["重みの種類が足りない", (c: ReturnType<typeof validConfig>) => ({ ...c, weights: { post: 1 } })],
    ["候補の数が 1", (c: ReturnType<typeof validConfig>) => ({ ...c, candidateCount: 1 })],
    ["候補の数が 5", (c: ReturnType<typeof validConfig>) => ({ ...c, candidateCount: 5 })],
    ["候補の数が整数でない", (c: ReturnType<typeof validConfig>) => ({ ...c, candidateCount: 2.5 })],
    ["減点が 1 を超える", (c: ReturnType<typeof validConfig>) => ({ ...c, recentPenalty: 1.5 })],
    [
      "一人称の表のキーワードが空",
      (c: ReturnType<typeof validConfig>) => ({ ...c, firstPersonRules: [{ keywords: [], mismatch: ["俺"] }] }),
    ],
    ["知らない項目がある", (c: ReturnType<typeof validConfig>) => ({ ...c, extra: true })],
    ["項目が欠けている", (c: ReturnType<typeof validConfig>) => ({ ...c, recentPenalty: undefined })],
  ])("TC-NOUS48_DEV-14 不正な値は ConfigError（%s）", (_label, mutate) => {
    expect(() => parseGenerationConfig(mutate(validConfig()))).toThrow(ConfigError);
  });

  it("TC-NOUS48_DEV-15 ファイルが無ければ ConfigError", () => {
    expect(() => loadGenerationConfig(join(tmpdir(), "nous48-missing", "generation.json"))).toThrow(ConfigError);
  });

  it("TC-NOUS48_DEV-16 JSON として読めなければ ConfigError", () => {
    expect(() => loadGenerationConfig(writeTemp("{ not json"))).toThrow(ConfigError);
  });

  it("TC-NOUS48_DEV-17 エラーの文言に不正な項目の場所が入る", () => {
    const path = writeTemp(JSON.stringify({ ...validConfig(), candidateCount: 9 }));
    expect(() => loadGenerationConfig(path)).toThrow(/candidateCount/);
  });
});
