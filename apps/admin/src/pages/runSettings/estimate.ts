// P205 見込みの計算（純粋関数）。FE 詳細設計 admin_control 4章 computeEstimate、BE 詳細設計 world 4章 estimateDaily。
import type { SettingsEstimateBasis } from "@nous/shared";

export interface EstimateFormInput {
  cycleMinutes: number | string;
  activityPercent: number | string;
  dailyNeuronsLimit: number | string;
}

export interface Estimate {
  avgNeuronsPerRun: number;
  runsPerCycle: number;
  neuronsPerCycle: number;
  cyclesPerDay: number;
  dailyRuns: number;
  dailyNeurons: number;
  cycleMinutesFloor: number;
  minCycleMinutes: number;
  overLimit: boolean;
}

function toPositiveNumber(value: number | string): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function toNonNegativeNumber(value: number | string): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export function computeEstimate(
  form: EstimateFormInput,
  avgNeuronsPerRunOrBasis: number | SettingsEstimateBasis,
  activeAgents = 0,
  avgParticipation = 0,
): Estimate {
  const avgNeuronsPerRun =
    typeof avgNeuronsPerRunOrBasis === "number" ? avgNeuronsPerRunOrBasis : avgNeuronsPerRunOrBasis.avgNeuronsPerRun;
  const agents = typeof avgNeuronsPerRunOrBasis === "number" ? activeAgents : avgNeuronsPerRunOrBasis.activeAgents;
  const participation =
    typeof avgNeuronsPerRunOrBasis === "number" ? avgParticipation : avgNeuronsPerRunOrBasis.avgParticipation;

  const safeAvgNeurons = toNonNegativeNumber(avgNeuronsPerRun);
  const safeAgents = toNonNegativeNumber(agents);
  const safeParticipation = toNonNegativeNumber(participation);
  const cycleMinutes = toPositiveNumber(form.cycleMinutes);
  const activityPercent = toNonNegativeNumber(form.activityPercent);
  const dailyNeuronsLimit = toNonNegativeNumber(form.dailyNeuronsLimit);

  // 1. 1巡の LLM の回数 = 体数 × 活動量 ÷ 100 × 参加の平均
  const runsPerCycle = safeAgents * (activityPercent / 100) * safeParticipation;
  // 2. 1巡の Neurons
  const rawNeuronsPerCycle = runsPerCycle * safeAvgNeurons;
  const neuronsPerCycle = Math.round(rawNeuronsPerCycle);
  // 3. 1日の巡 = 1440 ÷ 周期（0 除算を防ぐ）
  const cyclesPerDay = cycleMinutes > 0 ? 1440 / cycleMinutes : 0;
  // 4. 1日の回数・Neurons
  const dailyRuns = Math.round(runsPerCycle * cyclesPerDay);
  const dailyNeurons = Math.round(rawNeuronsPerCycle * cyclesPerDay);
  // 5. 周期の下限 = ceil(1440 ÷ (Neurons の上限 ÷ 1巡の Neurons))（0 除算を防ぐ）
  const maxCyclesPerDay = dailyNeuronsLimit > 0 && rawNeuronsPerCycle > 0 ? dailyNeuronsLimit / rawNeuronsPerCycle : 0;
  const cycleMinutesFloor = maxCyclesPerDay > 0 ? Math.ceil(1440 / maxCyclesPerDay) : 0;
  // 6. overLimit = 1日の Neurons > Neurons の上限
  const overLimit = dailyNeurons > dailyNeuronsLimit;

  return {
    avgNeuronsPerRun: safeAvgNeurons,
    runsPerCycle,
    neuronsPerCycle,
    cyclesPerDay,
    dailyRuns,
    dailyNeurons,
    cycleMinutesFloor,
    minCycleMinutes: cycleMinutesFloor,
    overLimit,
  };
}
