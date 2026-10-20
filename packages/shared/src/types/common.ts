import type { ErrorCode } from "../constants.js";

/** ISO 8601 の UTC 時刻（例: 2026-10-22T05:21:00.000Z。DB では 24 字） */
export type IsoDateTime = string;
/** 利用日（YYYY-MM-DD） */
export type UsageDate = string;
/** ULID（26 字） */
export type Id = string;
/** ページ送りのカーソル（前回の nextCursor。null は続きがない） */
export type Cursor = string;

/** JSON の値（生成ログの入力・管理操作履歴の before・after） */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** エラーの本文（admin_auth 2章の共通の決まり。観察 API も同じ形） */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** VALIDATION_ERROR のときの項目ごとのメッセージ */
    fields?: Record<string, string>;
  };
}

/** カーソルで続きを取る一覧の応答 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: Cursor | null;
}

/** 本文のない成功（204）の応答 */
export type NoContent = void;
