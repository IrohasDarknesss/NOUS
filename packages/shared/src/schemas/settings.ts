// SettingsSchema（BE 詳細設計 world 2章 PUT /admin/api/settings）。
// promptVersion が prompts/ にある版かどうかはサーバーで確かめる（listPromptVersions）。
import { z } from "zod";
import { MODEL_OPTIONS, PROMPT_VERSION_MAX, SETTINGS_RANGES, type NumericSettingKey } from "../constants.js";

const ranged = (key: NumericSettingKey) => z.number().int().min(SETTINGS_RANGES[key].min).max(SETTINGS_RANGES[key].max);

export const SettingsSchema = z.object({
  cycleMinutes: ranged("cycleMinutes"),
  activityPercent: ranged("activityPercent"),
  maxRefPosts: ranged("maxRefPosts"),
  maxMemoryChars: ranged("maxMemoryChars"),
  maxInputTokens: ranged("maxInputTokens"),
  maxOutputTokens: ranged("maxOutputTokens"),
  dailyNeuronsLimit: ranged("dailyNeuronsLimit"),
  dailyRunsLimit: ranged("dailyRunsLimit"),
  maxConcurrency: ranged("maxConcurrency"),
  modelId: z.enum(MODEL_OPTIONS),
  promptVersion: z.string().min(1).max(PROMPT_VERSION_MAX),
});
export type SettingsInput = z.output<typeof SettingsSchema>;
