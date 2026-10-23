// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_shared.json
import { describe, expect, it } from "vitest";
import { ADMIN_PORT, AUDIT_OPERATIONS, DEFAULT_SETTINGS, OBSERVER_PORT, TOKEN_LENGTH } from "./index";

describe("定数（単体テスト）", () => {
  it("TC-UT_SHR-030 管理操作の種類が基本設計書 7章の 18 種と同じ並びである", () => {
    expect(AUDIT_OPERATIONS).toEqual([
      "world.start",
      "world.pause",
      "world.resume",
      "world.emergency_stop",
      "world.reset",
      "settings.update",
      "agent.create",
      "agent.update",
      "agent.delete",
      "agent.stop",
      "agent.resume",
      "post.hide",
      "post.unhide",
      "invitation.issue",
      "invitation.revoke",
      "admin.login",
      "admin.logout",
      "admin.login_failed",
    ]);
  });

  it("TC-UT_SHR-031 実行設定の既定値が DB 物理設計書（world_settings の DEFAULT）と同じである", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      cycleMinutes: 20,
      activityPercent: 100,
      maxRefPosts: 12,
      maxMemoryChars: 1200,
      maxInputTokens: 1500,
      maxOutputTokens: 300,
      dailyNeuronsLimit: 9500,
      dailyRunsLimit: 480,
      maxConcurrency: 1,
      modelId: "@cf/google/gemma-4-26b-a4b-it",
      promptVersion: "v1",
    });
  });

  it("TC-UT_SHR-032 既定のポートは観察 8080・管理 8081、トークンは 43 字", () => {
    expect(OBSERVER_PORT).toBe(8080);
    expect(ADMIN_PORT).toBe(8081);
    expect(TOKEN_LENGTH).toBe(43);
  });
});
