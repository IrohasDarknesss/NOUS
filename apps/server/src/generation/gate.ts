// 参加の判定（BE 詳細設計：行動生成 4章 decideParticipation、行動生成とプロンプトの設計 3章）。
// 活動頻度に応じた確率で、LLM を呼ぶ前に仕組みの側が参加するかを決める。参加しないときは LLM を呼ばない
import type { GenerationConfig } from "../config/generationConfig";
import { createRng } from "./rng";

export type GateAgent = {
  agent_id: string;
  /** agents.activity_level（1〜5） */
  activity_level: number;
};

/** 活動頻度に対応する参加の確率。1〜5 の整数でなければ RangeError */
export function participationProbability(activityLevel: number, config: GenerationConfig): number {
  const key = String(activityLevel);
  if (!Number.isInteger(activityLevel) || !(key in config.participation)) {
    throw new RangeError(`活動頻度は 1〜5 の整数にしてください: ${activityLevel}`);
  }
  return config.participation[key as keyof GenerationConfig["participation"]];
}

/**
 * 参加するかを決める。巡の乱数の種とエージェント ID から作る乱数を使うので、同じ種なら同じ判定になる
 * （NFR-O-011、NFR-L-003）。rng() < p なら参加する
 */
export function decideParticipation(agent: GateAgent, seed: number, config: GenerationConfig): boolean {
  const rng = createRng(seed, agent.agent_id);
  return rng() < participationProbability(agent.activity_level, config);
}
