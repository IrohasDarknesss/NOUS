// 行動の種類の候補（BE 詳細設計：行動生成 4章 availableActions・drawCandidates、行動生成とプロンプトの設計 4章）。
// 選べる種類に基本の重みを付け、直近の自分の行動に含まれる種類を減点して、重みに比例した確率で重複なしに抽選する
import type { ActionKind, GenerationConfig } from "../config/generationConfig";
import { createRng } from "./rng";

/** 候補を並べる順（抽選の結果を決定的にするため、重みを数える順を固定する） */
export const ACTION_KINDS: readonly ActionKind[] = ["post", "reply", "like", "follow", "unfollow"];

/**
 * 候補の抽選に使う乱数。参加の判定（gate）と同じ種から作るが、salt を分けて判定の乱数と同じ列にならないようにする
 */
export function createCandidateRng(seed: number, agentId: string): () => number {
  return createRng(seed, `${agentId}:candidates`);
}

/**
 * 今回選べる行動の種類。post はいつも、reply は参照する投稿があるとき、like はいいねできる投稿があるとき、
 * follow はフォローできる住人がいるとき、unfollow はフォロー中の住人がいるとき
 */
export function availableActions(
  refs: readonly unknown[],
  likeable: readonly string[],
  followTargets: readonly unknown[],
  followees: readonly unknown[],
): ActionKind[] {
  const available: ActionKind[] = ["post"];
  if (refs.length > 0) available.push("reply");
  if (likeable.length > 0) available.push("like");
  if (followTargets.length > 0) available.push("follow");
  if (followees.length > 0) available.push("unfollow");
  return available;
}

/** 種類ごとの重み。直近の行動に含まれるたびに recentPenalty を掛ける */
export function candidateWeights(
  available: readonly ActionKind[],
  recent: readonly ActionKind[],
  config: GenerationConfig,
): Map<ActionKind, number> {
  const weights = new Map<ActionKind, number>();
  for (const kind of ACTION_KINDS) {
    if (!available.includes(kind)) continue;
    const times = recent.filter((r) => r === kind).length;
    weights.set(kind, config.weights[kind] * config.recentPenalty ** times);
  }
  return weights;
}

/**
 * 候補を config.candidateCount 個まで、重みに比例した確率で重複なしに抽選する。
 * 選べる種類が足りなければ、その数だけ返す。重み 0 の種類は選ばない。候補が 0 なら ['post']
 */
export function drawCandidates(
  rng: () => number,
  available: readonly ActionKind[],
  recent: readonly ActionKind[],
  config: GenerationConfig,
): ActionKind[] {
  const pool = [...candidateWeights(available, recent, config)].filter(([, w]) => w > 0);
  const picked: ActionKind[] = [];
  while (picked.length < config.candidateCount && pool.length > 0) {
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    const r = rng() * total;
    let index = pool.length - 1;
    let cumulative = 0;
    for (let i = 0; i < pool.length; i++) {
      cumulative += pool[i]![1];
      if (r < cumulative) {
        index = i;
        break;
      }
    }
    picked.push(pool[index]![0]);
    pool.splice(index, 1);
  }
  return picked.length > 0 ? picked : ["post"];
}
