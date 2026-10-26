// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_gate_candidates_rng.json
import { describe, expect, it } from "vitest";
import { createRng, fnv1a32, mulberry32 } from "./rng";

/** FNV-1a（32 ビット）をバイト列に手でかけた値 */
function fnvOf(bytes: number[]): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

describe("rng（単体テスト）", () => {
  it("TC-UT_CAND-001 salt が空の文字列なら、種とオフセット基底（0x811c9dc5）の XOR を mulberry32 に渡す", () => {
    const a = createRng(12345, "");
    const b = mulberry32((12345 ^ 0x811c9dc5) >>> 0);

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("TC-UT_CAND-002 FNV-1a は UTF-8 のバイト列にかける（「あ」は E3 81 82 の 3 バイト）", () => {
    const expected = fnvOf([0xe3, 0x81, 0x82]);

    expect(fnv1a32("あ")).toBe(expected);
  });

  it.each([0, 0xffffffff, -1])("TC-UT_CAND-003 種の境界でも 0 以上 1 未満の値を返す（%s）", (seed) => {
    const rng = createRng(seed, "agent");

    const values = Array.from({ length: 100 }, () => rng());

    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("TC-UT_CAND-004 種 -1 は 0xFFFFFFFF と同じ乱数列になる（32 ビットに丸める）", () => {
    const a = createRng(-1, "agent");
    const b = createRng(0xffffffff, "agent");

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("TC-UT_CAND-005 乱数の関数ごとに状態を持ち、別に作った関数の列に影響しない", () => {
    const a = createRng(7, "agent");
    const b = createRng(7, "agent");

    const first = a();
    a();
    a();

    expect(b()).toBe(first);
  });
});
