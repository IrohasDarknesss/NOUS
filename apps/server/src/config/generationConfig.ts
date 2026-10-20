// config/generation.json の読み込みと検証（BE 詳細設計：行動生成 4章 loadGenerationConfig、
// 行動生成とプロンプトの設計 3・4・9章）。起動時に1回だけ読み、変更はプロセスの再起動で反映する
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError } from "../lib/errors.js";

// 外から使う人のために再 export しておく（定義は lib/errors.ts の1か所）
export { ConfigError };

const probability = z.number().min(0).max(1);
const weight = z.number().min(0);
const nonEmptyStrings = z.array(z.string().min(1)).min(1);

export const GenerationConfigSchema = z
  .object({
    // 活動頻度（agents.activity_level 1〜5）ごとの参加する確率（3章）
    participation: z
      .object({ "1": probability, "2": probability, "3": probability, "4": probability, "5": probability })
      .strict(),
    // 行動の種類の候補の数（4章。2〜4、既定 2）
    candidateCount: z.number().int().min(2).max(4),
    // 行動の種類ごとの基本の重み（4章）
    weights: z.object({ post: weight, reply: weight, like: weight, follow: weight, unfollow: weight }).strict(),
    // 直近2回の自分の行動に含まれる種類の重みに、1回ごとに掛ける値（4章。既定 0.4）
    recentPenalty: probability,
    // C03：性格のキーワードと合わない一人称の表（9章）
    firstPersonRules: z.array(z.object({ keywords: nonEmptyStrings, mismatch: nonEmptyStrings }).strict()),
  })
  .strict();

export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;
export type ActionKind = keyof GenerationConfig["weights"];

/** JSON の値を検証する。不正なら ConfigError */
export function parseGenerationConfig(value: unknown, source = "config/generation.json"): GenerationConfig {
  const result = GenerationConfigSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new ConfigError(`${source} の内容が正しくありません: ${issues.join("; ")}`, { cause: result.error });
  }
  return result.data;
}

/** config/generation.json を読んで検証する。読めない・JSON でない・不正なら ConfigError */
export function loadGenerationConfig(path: string): GenerationConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`${path} を読めません`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} が JSON として読めません`, { cause: error });
  }
  return parseGenerationConfig(value, path);
}
