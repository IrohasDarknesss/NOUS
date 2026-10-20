// ページ送りのカーソル（BE 詳細設計 admin_auth 4章 encodeCursor・decodeCursor）
import { AppError } from "./errors";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 文字列の配列を JSON.stringify して Base64URL に符号化する */
export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/**
 * Base64URL のカーソルを復号して文字列の配列を返す。
 * Base64URL でない・JSON でない・文字列の配列でない場合は 400 VALIDATION_ERROR（fields.cursor）
 */
export function decodeCursor(cursor: string): string[] {
  if (!cursor || !BASE64URL_PATTERN.test(cursor)) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  return parsed;
}
