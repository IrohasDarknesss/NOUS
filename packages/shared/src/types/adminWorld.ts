// 管理 API：世界の制御と実行設定の 8 本（BE 詳細設計 world 2章）
import type { ModelId, StopReason, WorldState } from "../constants.js";
import type { Id, IsoDateTime, UsageDate } from "./common.js";

// ---- GET /admin/api/world ----

/** 利用日の利用量と上限（UsageCard が描く） */
export interface UsageView {
  usageDate: UsageDate;
  neurons: number;
  neuronsLimit: number;
  runs: number;
  runsLimit: number;
  freeTierNeurons: number;
}
export interface AdminWorld {
  worldId: Id;
  name: string;
  state: WorldState;
  stopReason: StopReason | null;
  worldTimeSec: number;
  cycleNo: number;
  nextCycleAt: IsoDateTime | null;
  usage: UsageView;
  runningGenerations: number;
  agentCounts: { active: number; stopped: number };
}
export type AdminWorldResponse = AdminWorld;

// ---- POST /admin/api/world/start ----

export interface WorldStartResponse {
  /** 上限に達していれば limit_stopped */
  state: "running" | "limit_stopped";
  startedAt: IsoDateTime;
}

// ---- POST /admin/api/world/pause ----

export interface WorldPauseResponse {
  state: "paused";
  worldTimeSec: number;
  runningGenerations: number;
}

// ---- POST /admin/api/world/resume ----

export interface WorldResumeResponse {
  state: "running" | "limit_stopped";
  stopReason: StopReason | null;
}

// ---- POST /admin/api/world/emergency-stop ----

export interface WorldEmergencyStopResponse {
  state: "emergency_stopped";
  cancelledGenerations: number;
}

// ---- POST /admin/api/world/reset ----

export interface WorldResetRequest {
  confirmName: string;
}
export interface WorldResetResponse {
  archivedWorldId: Id;
  newWorldId: Id;
  state: "preparing";
}

// ---- GET /admin/api/settings ----

/** 実行設定（world_settings の全項目） */
export interface RunSettings {
  cycleMinutes: number;
  activityPercent: number;
  maxRefPosts: number;
  maxMemoryChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  dailyNeuronsLimit: number;
  dailyRunsLimit: number;
  maxConcurrency: number;
  modelId: ModelId;
  promptVersion: string;
}
/** 見込みの計算に使う実測（EstimatePanel が画面の入力に合わせて計算し直す） */
export interface SettingsEstimateBasis {
  /** 直近 50 件の成功した LLM の生成の Neurons の平均（20 件未満なら見積もり 16.4） */
  avgNeuronsPerRun: number;
  activeAgents: number;
  avgParticipation: number;
}
export interface SettingsResponse extends SettingsEstimateBasis {
  settings: RunSettings;
  estimatedCycleMinutes: number;
  estimatedDailyRuns: number;
  estimatedDailyNeurons: number;
  modelOptions: ModelId[];
  promptVersions: string[];
}

// ---- PUT /admin/api/settings ----

export type SettingsUpdateRequest = RunSettings;
export interface SettingsUpdateResponse {
  settings: RunSettings;
  estimatedCycleMinutes: number;
  estimatedDailyRuns: number;
  /** 上限の変更で状態が変わったとき（例: "limit_stopped→running"） */
  stateChanged?: string | null;
}
