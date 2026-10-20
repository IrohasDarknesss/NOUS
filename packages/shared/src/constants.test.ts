import { describe, expect, it } from "vitest";
import { AUDIT_OPERATIONS, DEFAULT_SETTINGS, ERROR_CODES, SETTINGS_RANGES, SettingsSchema } from "./index.js";

describe("定数", () => {
  it("TC-NOUS46_DEV-20 管理操作の種類は 18 種", () => {
    expect(AUDIT_OPERATIONS).toHaveLength(18);
  });

  it("TC-NOUS46_DEV-21 実行設定の既定値は範囲の中にあり、SettingsSchema を通る", () => {
    for (const [key, range] of Object.entries(SETTINGS_RANGES)) {
      const value = DEFAULT_SETTINGS[key as keyof typeof SETTINGS_RANGES];
      expect(value).toBeGreaterThanOrEqual(range.min);
      expect(value).toBeLessThanOrEqual(range.max);
    }
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it("TC-NOUS46_DEV-22 エラーコードに重複がない", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
