// 入力の検証に共通で使う部品。クエリの値は文字列で届くため、数値は coerce で変換する。
import { z } from "zod";
import { ADMIN_PAGE_LIMIT, ID_LENGTH, OBSERVER_PAGE_LIMIT, TOKEN_LENGTH } from "../constants.js";

/** ULID（26 字） */
export const IdSchema = z.string().length(ID_LENGTH);

/** 43 字の Base64URL（招待トークン・セッション ID・CSRF トークン） */
export const TokenSchema = z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`));

/** ページ送りのカーソル（Base64URL） */
export const CursorSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

/** 範囲つきの整数のクエリ（省略時は既定値） */
export function intQuery(min: number, max: number, defaultValue: number) {
  return z.coerce.number().int().min(min).max(max).default(defaultValue);
}

/** 観察 API の limit（1〜50、既定 30） */
export const ObserverLimitSchema = intQuery(
  OBSERVER_PAGE_LIMIT.min,
  OBSERVER_PAGE_LIMIT.max,
  OBSERVER_PAGE_LIMIT.default,
);

/** 管理 API の limit（1〜100、既定 50） */
export const AdminLimitSchema = intQuery(ADMIN_PAGE_LIMIT.min, ADMIN_PAGE_LIMIT.max, ADMIN_PAGE_LIMIT.default);

/** 利用日（YYYY-MM-DD で、実在する日付） */
export const UsageDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "日付が正しくありません");

/** ISO 8601 の日時 */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** 管理 API のページ送り（cursor・limit） */
export const AdminPageQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: AdminLimitSchema,
});
