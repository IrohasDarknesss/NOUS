import { describe, expect, it } from "vitest";
import { createRng, fnv1a32, mulberry32 } from "./rng";

function take(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

describe("rng", () => {
  it("TC-NOUS48_DEV-01 同じ種と salt からは同じ乱数列が出る", () => {
    expect(take(createRng(12345, "01J0AGENT"), 20)).toEqual(take(createRng(12345, "01J0AGENT"), 20));
  });

  it("TC-NOUS48_DEV-02 salt が違えば乱数列が変わる", () => {
    expect(take(createRng(12345, "agent-a"), 5)).not.toEqual(take(createRng(12345, "agent-b"), 5));
  });

  it("TC-NOUS48_DEV-03 種が違えば乱数列が変わる", () => {
    expect(take(createRng(1, "agent-a"), 5)).not.toEqual(take(createRng(2, "agent-a"), 5));
  });

  it("TC-NOUS48_DEV-04 値はいつも 0 以上 1 未満", () => {
    for (const value of take(createRng(0xffffffff, "x"), 10000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("TC-NOUS48_DEV-05 mulberry32 は既知の値を返す（種 1）", () => {
    expect(take(mulberry32(1), 3)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("TC-NOUS48_DEV-06 FNV-1a は既知の値を返す", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  it("TC-NOUS48_DEV-07 createRng は salt のハッシュと種の XOR を mulberry32 に渡す", () => {
    expect(take(createRng(12345, "01J0AGENT"), 2)).toEqual(take(mulberry32((12345 ^ fnv1a32("01J0AGENT")) >>> 0), 2));
    expect(take(createRng(12345, "01J0AGENT"), 2)).toEqual([0.39538378175348043, 0.18933362886309624]);
  });
});
