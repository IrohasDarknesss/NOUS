import { describe, expect, it } from "vitest";
import {
  AgentInputSchema,
  FollowsQuerySchema,
  GenerationListQuerySchema,
  HideRequestSchema,
  InvitationCreateRequestSchema,
  InviteParamsSchema,
  LoginRequestSchema,
  MetricsQuerySchema,
  PostSearchQuerySchema,
  SettingsSchema,
  ThreadQuerySchema,
  TimelineQuerySchema,
} from "../index.js";

const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const validAgent = {
  handle: "minato_01",
  displayName: "ミナト",
  interests: "天気",
  topics: "地域",
  personality: "穏やか",
  valuesText: "誠実",
  stance: "中立",
  activityLevel: 3,
  noRealPersonConfirmed: true,
};

const validSettings = {
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
};

describe("AgentInputSchema", () => {
  it("TC-NOUS46_DEV-01 正しい入力を受け付け、bio の既定値を '' にする", () => {
    const r = AgentInputSchema.safeParse(validAgent);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bio).toBe("");
  });

  it("TC-NOUS46_DEV-02 handle は 3〜20 字の半角英数字と _ だけ", () => {
    expect(AgentInputSchema.safeParse({ ...validAgent, handle: "ab" }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, handle: "abc" }).success).toBe(true);
    expect(AgentInputSchema.safeParse({ ...validAgent, handle: "a".repeat(20) }).success).toBe(true);
    expect(AgentInputSchema.safeParse({ ...validAgent, handle: "a".repeat(21) }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, handle: "mi-nato" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-03 文字列は前後の空白を除いてから字数を数える", () => {
    const r = AgentInputSchema.safeParse({ ...validAgent, displayName: "  ミナト  " });
    expect(r.success && r.data.displayName).toBe("ミナト");
    expect(AgentInputSchema.safeParse({ ...validAgent, interests: "   " }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-04 属性は 100 字まで、bio は 200 字まで", () => {
    expect(AgentInputSchema.safeParse({ ...validAgent, stance: "あ".repeat(100) }).success).toBe(true);
    expect(AgentInputSchema.safeParse({ ...validAgent, stance: "あ".repeat(101) }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, bio: "あ".repeat(200) }).success).toBe(true);
    expect(AgentInputSchema.safeParse({ ...validAgent, bio: "あ".repeat(201) }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-05 activityLevel は 1〜5 の整数", () => {
    expect(AgentInputSchema.safeParse({ ...validAgent, activityLevel: 0 }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, activityLevel: 5 }).success).toBe(true);
    expect(AgentInputSchema.safeParse({ ...validAgent, activityLevel: 6 }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, activityLevel: 2.5 }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-06 noRealPersonConfirmed は true だけを受け付ける", () => {
    expect(AgentInputSchema.safeParse({ ...validAgent, noRealPersonConfirmed: false }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...validAgent, noRealPersonConfirmed: undefined }).success).toBe(false);
  });
});

describe("SettingsSchema", () => {
  it("TC-NOUS46_DEV-07 既定の設定を受け付ける", () => {
    expect(SettingsSchema.safeParse(validSettings).success).toBe(true);
  });

  it("TC-NOUS46_DEV-08 各項目の範囲の境界", () => {
    expect(SettingsSchema.safeParse({ ...validSettings, cycleMinutes: 14 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...validSettings, cycleMinutes: 15 }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...validSettings, cycleMinutes: 120 }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...validSettings, cycleMinutes: 121 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...validSettings, maxConcurrency: 4 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...validSettings, dailyNeuronsLimit: 10001 }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-09 modelId は 2 つの候補のどちらか", () => {
    expect(SettingsSchema.safeParse({ ...validSettings, modelId: "@cf/qwen/qwen3-30b-a3b-fp8" }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...validSettings, modelId: "@cf/other" }).success).toBe(false);
  });
});

describe("管理 API の要求", () => {
  it("TC-NOUS46_DEV-10 password は 12〜128 字", () => {
    expect(LoginRequestSchema.safeParse({ password: "a".repeat(11) }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ password: "a".repeat(12) }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ password: "a".repeat(128) }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ password: "a".repeat(129) }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-11 招待の label は前後の空白を除いて 1〜30 字", () => {
    expect(InvitationCreateRequestSchema.safeParse({ label: "  " }).success).toBe(false);
    expect(InvitationCreateRequestSchema.safeParse({ label: "あ".repeat(30) }).success).toBe(true);
    expect(InvitationCreateRequestSchema.safeParse({ label: "あ".repeat(31) }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-12 非表示の理由は任意で 200 字まで", () => {
    expect(HideRequestSchema.safeParse({}).success).toBe(true);
    expect(HideRequestSchema.safeParse({ reason: "あ".repeat(200) }).success).toBe(true);
    expect(HideRequestSchema.safeParse({ reason: "あ".repeat(201) }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-13 投稿の検索は q が 1〜50 字、limit は既定 50", () => {
    const r = PostSearchQuerySchema.safeParse({ q: "天気", visibility: "hidden" });
    expect(r.success && r.data.limit).toBe(50);
    expect(PostSearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(PostSearchQuerySchema.safeParse({ q: "あ".repeat(51) }).success).toBe(false);
    expect(PostSearchQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-14 生成ログの一覧は from ≦ to", () => {
    const ok = { from: "2026-10-22T00:00:00.000Z", to: "2026-10-22T05:00:00.000Z", status: "failed" };
    expect(GenerationListQuerySchema.safeParse(ok).success).toBe(true);
    expect(GenerationListQuerySchema.safeParse({ from: ok.to, to: ok.from }).success).toBe(false);
    expect(GenerationListQuerySchema.safeParse({ action: "dance" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-15 指標の期間は from ≦ to で 90 日まで", () => {
    expect(MetricsQuerySchema.safeParse({}).success).toBe(true);
    expect(MetricsQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-22" }).success).toBe(true);
    expect(MetricsQuerySchema.safeParse({ from: "2026-10-23", to: "2026-10-22" }).success).toBe(false);
    expect(MetricsQuerySchema.safeParse({ from: "2026-07-25", to: "2026-10-22" }).success).toBe(true);
    expect(MetricsQuerySchema.safeParse({ from: "2026-07-24", to: "2026-10-22" }).success).toBe(false);
    expect(MetricsQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
  });
});

describe("観察 API の要求", () => {
  it("TC-NOUS46_DEV-16 timeline の limit は文字列から変換し、1〜50、既定 30", () => {
    const r = TimelineQuerySchema.safeParse({});
    expect(r.success && r.data.limit).toBe(30);
    const s = TimelineQuerySchema.safeParse({ limit: "50", since: ID });
    expect(s.success && s.data.limit).toBe(50);
    expect(TimelineQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(TimelineQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(TimelineQuerySchema.safeParse({ since: "short" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-17 thread の depth は 1〜10、既定 5", () => {
    const r = ThreadQuerySchema.safeParse({});
    expect(r.success && r.data.depth).toBe(5);
    expect(ThreadQuerySchema.safeParse({ depth: "10" }).success).toBe(true);
    expect(ThreadQuerySchema.safeParse({ depth: "11" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-18 follows の type は following・followers のどちらか", () => {
    expect(FollowsQuerySchema.safeParse({ type: "followers" }).success).toBe(true);
    expect(FollowsQuerySchema.safeParse({}).success).toBe(false);
    expect(FollowsQuerySchema.safeParse({ type: "friends" }).success).toBe(false);
  });

  it("TC-NOUS46_DEV-19 招待トークンは 43 字の Base64URL", () => {
    expect(InviteParamsSchema.safeParse({ token: "A".repeat(43) }).success).toBe(true);
    expect(InviteParamsSchema.safeParse({ token: "A".repeat(42) }).success).toBe(false);
    expect(InviteParamsSchema.safeParse({ token: `${"A".repeat(42)}+` }).success).toBe(false);
  });
});
