// トークンとハッシュ（BE 詳細設計 admin_auth 4章 randomToken・sha256Hex、6章「時間一定の比較」）
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 暗号論的に安全な乱数を Base64URL で返す（32 バイトで 43 字） */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new RangeError("randomToken の bytes は 1 以上の整数にしてください");
  }
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 の 16 進（64 字）。セッション ID・招待トークンは DB にこの値だけを持つ */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 文字列を時間一定で比べる（CSRF トークンの照合などに使う）。長さが違えば false */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
