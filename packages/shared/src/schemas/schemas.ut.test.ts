// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_shared.json
import { describe, expect, it } from "vitest";
import {
  AdminLimitSchema,
  AgentIdParamsSchema,
  AgentInputSchema,
  AgentListQuerySchema,
  AuditLogQuerySchema,
  CursorSchema,
  EventIdParamsSchema,
  GenerationListQuerySchema,
  HideRequestSchema,
  IdSchema,
  InvitationCreateRequestSchema,
  InvitationIdParamsSchema,
  IsoDateTimeSchema,
  LoginRequestSchema,
  MetricsQuerySchema,
  ObserverLimitSchema,
  PostIdParamsSchema,
  PostSearchQuerySchema,
  SettingsSchema,
  TokenSchema,
  UsageDateSchema,
  WorldIdParamsSchema,
  WorldResetRequestSchema,
} from "../index";

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

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown): boolean =>
  schema.safeParse(value).success;

describe("共通の部品（単体テスト）", () => {
  it.each([
    ["25 字", "A".repeat(25), false],
    ["26 字", "A".repeat(26), true],
    ["27 字", "A".repeat(27), false],
  ])("TC-UT_SHR-001 IdSchema は 26 字だけを受け付ける（%s）", (_label, value, expected) => {
    expect(ok(IdSchema, value)).toBe(expected);
  });

  it.each([
    ["43 字の - と _", `${"A".repeat(41)}-_`, true],
    ["44 字", "A".repeat(44), false],
    ["= を含む", `${"A".repeat(42)}=`, false],
  ])("TC-UT_SHR-002 TokenSchema は 43 字の Base64URL だけを受け付ける（%s）", (_label, value, expected) => {
    expect(ok(TokenSchema, value)).toBe(expected);
  });

  it.each([
    ["空", "", false],
    ["1 字", "a", true],
    ["200 字", "a".repeat(200), true],
    ["201 字", "a".repeat(201), false],
    ["パディング付き", "WyJhIl0=", false],
  ])("TC-UT_SHR-003 CursorSchema は 1〜200 字の Base64URL だけを受け付ける（%s）", (_label, value, expected) => {
    expect(ok(CursorSchema, value)).toBe(expected);
  });

  it.each([
    ["文字列の 1", "1", true],
    ["数値の 1", 1, true],
    ["小数", "2.5", false],
    ["数字でない", "abc", false],
  ])(
    "TC-UT_SHR-004 ObserverLimitSchema は下限 1 の整数だけを受け付け、文字列も数値にする（%s）",
    (_label, value, expected) => {
      expect(ok(ObserverLimitSchema, value)).toBe(expected);
    },
  );

  it.each([
    ["省略", undefined, 50],
    ["1", "1", 1],
    ["100", "100", 100],
  ])("TC-UT_SHR-005 AdminLimitSchema は 1〜100 を受け付け、省略時は 50 にする（%s）", (_label, value, expected) => {
    expect(AdminLimitSchema.parse(value)).toBe(expected);
  });

  it("TC-UT_SHR-006 AdminLimitSchema は 0 を受け付けない", () => {
    expect(ok(AdminLimitSchema, "0")).toBe(false);
  });

  it.each([
    ["閏年の 2/29", "2028-02-29", true],
    ["平年の 2/29", "2026-02-29", false],
    ["13 月", "2026-13-01", false],
    ["月が 1 桁", "2026-1-01", false],
    ["区切りが /", "2026/10/01", false],
  ])("TC-UT_SHR-007 UsageDateSchema は実在する YYYY-MM-DD だけを受け付ける（%s）", (_label, value, expected) => {
    expect(ok(UsageDateSchema, value)).toBe(expected);
  });

  it.each([
    ["Z 付き", "2026-10-22T09:00:00.000Z", true],
    ["+09:00 付き", "2026-10-22T18:00:00+09:00", true],
    ["時差なし", "2026-10-22T09:00:00", false],
    ["日付だけ", "2026-10-22", false],
  ])(
    "TC-UT_SHR-008 IsoDateTimeSchema は時差のついた ISO 8601 の日時だけを受け付ける（%s）",
    (_label, value, expected) => {
      expect(ok(IsoDateTimeSchema, value)).toBe(expected);
    },
  );
});

describe("管理 API の要求（単体テスト）", () => {
  it("TC-UT_SHR-009 ログインのパスワードは前後の空白を除かずに字数を数える", () => {
    const r = LoginRequestSchema.safeParse({ password: ` ${"a".repeat(10)} ` });

    expect(r.success).toBe(true);
    expect(r.success && r.data.password).toBe(` ${"a".repeat(10)} `);
  });

  it("TC-UT_SHR-010 招待の label は前後の空白を除いた値にし、1 字を受け付ける", () => {
    const r = InvitationCreateRequestSchema.safeParse({ label: "  あ  " });

    expect(r.success && r.data.label).toBe("あ");
  });

  it.each([
    ["admin.login_failed", { operation: "admin.login_failed" }, true],
    ["一覧にない操作", { operation: "admin.unknown" }, false],
    ["カーソルが 201 字", { cursor: "a".repeat(201) }, false],
  ])("TC-UT_SHR-011 管理操作の履歴の絞り込みは 18 種の操作とカーソルを検証する（%s）", (_label, value, expected) => {
    expect(ok(AuditLogQuerySchema, value)).toBe(expected);
  });

  it("TC-UT_SHR-012 世界のリセットの確認の名前は 1 字以上", () => {
    expect(ok(WorldResetRequestSchema, { confirmName: "" })).toBe(false);
    expect(ok(WorldResetRequestSchema, { confirmName: "a" })).toBe(true);
  });

  it.each([
    ["from と to が同じ時刻", { from: "2026-10-22T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z" }, true],
    ["時差の違う同じ時刻", { from: "2026-10-22T09:00:00+09:00", to: "2026-10-22T00:00:00.000Z" }, true],
    ["from だけ", { from: "2026-10-22T00:00:00.000Z" }, true],
    ["to だけ", { to: "2026-10-22T00:00:00.000Z" }, true],
    ["時差を入れると from が後", { from: "2026-10-22T09:00:01+09:00", to: "2026-10-22T00:00:00.000Z" }, false],
  ])("TC-UT_SHR-013 生成ログの期間は時刻として from ≦ to を比べる（%s）", (_label, value, expected) => {
    expect(ok(GenerationListQuerySchema, value)).toBe(expected);
  });

  it("TC-UT_SHR-014 生成ログの期間が逆のとき、エラーは to の項目に付く", () => {
    const r = GenerationListQuerySchema.safeParse({ from: "2026-10-22T05:00:00.000Z", to: "2026-10-22T00:00:00.000Z" });

    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.map((i) => i.path)).toEqual([["to"]]);
  });

  it.each([
    ["q が 1 字", { q: "あ" }, true],
    ["q が 50 字", { q: "あ".repeat(50) }, true],
    ["agentId が 25 字", { agentId: "A".repeat(25) }, false],
    ["visibility が一覧にない", { visibility: "deleted" }, false],
  ])("TC-UT_SHR-015 投稿の検索の q・agentId・visibility の境界（%s）", (_label, value, expected) => {
    expect(ok(PostSearchQuerySchema, value)).toBe(expected);
  });

  it("TC-UT_SHR-016 非表示の理由は空の文字列でもよい", () => {
    expect(ok(HideRequestSchema, { reason: "" })).toBe(true);
  });

  it.each([
    ["from と to が同じ日（1 日）", { from: "2026-10-22", to: "2026-10-22" }, true],
    ["to だけ", { to: "2026-10-22" }, true],
    ["from の形が違う", { from: "2026/10/01", to: "2026-10-22" }, false],
  ])("TC-UT_SHR-017 指標の期間は 1 日から受け付け、日付の形を検証する（%s）", (_label, value, expected) => {
    expect(ok(MetricsQuerySchema, value)).toBe(expected);
  });

  it("TC-UT_SHR-018 指標の期間が 90 日を超えるとき、エラーの文言に 90 日が入る", () => {
    const r = MetricsQuerySchema.safeParse({ from: "2026-07-24", to: "2026-10-22" });

    expect(!r.success && r.error.issues[0]?.message).toBe("期間は 90 日以内にしてください");
  });

  it.each([
    ["agentId", AgentIdParamsSchema],
    ["postId", PostIdParamsSchema],
    ["eventId", EventIdParamsSchema],
    ["invitationId", InvitationIdParamsSchema],
    ["worldId", WorldIdParamsSchema],
  ] as const)("TC-UT_SHR-019 パスのパラメータは 26 字の ID だけを受け付ける（%s）", (key, schema) => {
    expect(ok(schema, { [key]: ID })).toBe(true);
    expect(ok(schema, { [key]: ID.slice(1) })).toBe(false);
    expect(ok(schema, {})).toBe(false);
  });
});

describe("エージェントの入力（単体テスト）", () => {
  it("TC-UT_SHR-020 handle は前後の空白を除いてから形を確かめる", () => {
    const r = AgentInputSchema.safeParse({ ...validAgent, handle: "  minato_01  " });

    expect(r.success && r.data.handle).toBe("minato_01");
  });

  it("TC-UT_SHR-021 handle に日本語を含めば受け付けない", () => {
    expect(ok(AgentInputSchema, { ...validAgent, handle: "みなと_01" })).toBe(false);
  });

  it.each([
    ["空", "", false],
    ["1 字", "ミ", true],
    ["30 字", "ミ".repeat(30), true],
    ["31 字", "ミ".repeat(31), false],
  ])("TC-UT_SHR-022 displayName は 1〜30 字（%s）", (_label, value, expected) => {
    expect(ok(AgentInputSchema, { ...validAgent, displayName: value })).toBe(expected);
  });

  it("TC-UT_SHR-023 bio が空白だけなら空の文字列にする", () => {
    const r = AgentInputSchema.safeParse({ ...validAgent, bio: "   " });

    expect(r.success && r.data.bio).toBe("");
  });

  it("TC-UT_SHR-024 activityLevel は文字列の数字を受け付けない（JSON の本文は変換しない）", () => {
    expect(ok(AgentInputSchema, { ...validAgent, activityLevel: "3" })).toBe(false);
  });

  it("TC-UT_SHR-025 必須の属性（valuesText）がなければ受け付けない", () => {
    const input: Partial<typeof validAgent> = { ...validAgent };
    delete input.valuesText;

    expect(ok(AgentInputSchema, input)).toBe(false);
  });

  it.each([
    ["省略", {}, true],
    ["stopped", { state: "stopped" }, true],
    ["一覧にない状態", { state: "deleted" }, false],
  ])("TC-UT_SHR-026 エージェントの一覧の state は active・stopped だけ（%s）", (_label, value, expected) => {
    expect(ok(AgentListQuerySchema, value)).toBe(expected);
  });
});

describe("実行設定（単体テスト）", () => {
  // BE 詳細設計 world 2章 PUT /admin/api/settings の範囲
  const RANGES: [string, number, number][] = [
    ["cycleMinutes", 15, 120],
    ["activityPercent", 10, 100],
    ["maxRefPosts", 1, 30],
    ["maxMemoryChars", 200, 3000],
    ["maxInputTokens", 500, 2000],
    ["maxOutputTokens", 100, 400],
    ["dailyNeuronsLimit", 1, 10000],
    ["dailyRunsLimit", 1, 2000],
    ["maxConcurrency", 1, 3],
  ];

  it.each(RANGES)("TC-UT_SHR-027 数値の項目は下限・上限を受け付け、その外側を受け付けない（%s）", (key, min, max) => {
    expect(ok(SettingsSchema, { ...validSettings, [key]: min - 1 })).toBe(false);
    expect(ok(SettingsSchema, { ...validSettings, [key]: min })).toBe(true);
    expect(ok(SettingsSchema, { ...validSettings, [key]: max })).toBe(true);
    expect(ok(SettingsSchema, { ...validSettings, [key]: max + 1 })).toBe(false);
  });

  it.each([
    ["小数", 20.5],
    ["文字列", "20"],
  ])("TC-UT_SHR-028 数値の項目は整数の数値だけを受け付ける（%s）", (_label, value) => {
    expect(ok(SettingsSchema, { ...validSettings, cycleMinutes: value })).toBe(false);
  });

  it.each([
    ["空", "", false],
    ["20 字", "v".repeat(20), true],
    ["21 字", "v".repeat(21), false],
  ])("TC-UT_SHR-029 promptVersion は 1〜20 字（%s）", (_label, value, expected) => {
    expect(ok(SettingsSchema, { ...validSettings, promptVersion: value })).toBe(expected);
  });
});
