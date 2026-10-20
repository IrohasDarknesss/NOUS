// ID の採番（BE 詳細設計 admin_auth 1章 ids.ts）。ID はすべて ULID（26 字、Crockford の Base32）
import { ulid } from "ulid";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 新しい ULID を返す。時刻の部分は Clock の時刻を渡せる（省略時は実時刻） */
export function newUlid(timeMs?: number): string {
  return ulid(timeMs);
}

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
