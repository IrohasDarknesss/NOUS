// scrypt によるパスワードのハッシュと照合（BE 詳細設計 admin_auth 4章 hashPassword・verifyPassword、6章「時間一定の比較」）
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_BYTES = 16;

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r, p }, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

const isCanonicalBase64 = (s: string, expectedBytes: number): { ok: true; buf: Buffer } | { ok: false } => {
  if (s.length === 0) return { ok: false };
  const buf = Buffer.from(s, "base64");
  if (buf.length !== expectedBytes || buf.toString("base64") !== s) {
    return { ok: false };
  }
  return { ok: true, buf };
};

/**
 * パスワードを scrypt（N=16384, r=8, p=1, keylen=64, 16 バイトのソルト）でハッシュし、
 * `scrypt$16384$8$1$<ソルトの Base64>$<ハッシュの Base64>` の文字列を返す
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LEN);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * 保存されたハッシュ文字列を分解して同じパラメータで scrypt を計算し、timingSafeEqual で比べる。
 * 形式が不正なら例外にせず false を返す
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [scheme, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (scheme !== "scrypt" || !nStr || !rStr || !pStr || !saltB64 || !hashB64) {
    return false;
  }
  if (!/^\d+$/.test(nStr) || !/^\d+$/.test(rStr) || !/^\d+$/.test(pStr)) {
    return false;
  }
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return false;
  }
  const saltDecoded = isCanonicalBase64(saltB64, SALT_BYTES);
  const hashDecoded = isCanonicalBase64(hashB64, KEY_LEN);
  if (!saltDecoded.ok || !hashDecoded.ok) {
    return false;
  }
  try {
    const derived = await deriveKey(password, saltDecoded.buf, N, r, p, hashDecoded.buf.length);
    if (derived.length !== hashDecoded.buf.length) return false;
    return timingSafeEqual(derived, hashDecoded.buf);
  } catch {
    return false;
  }
}
