// 種から作る乱数（BE 詳細設計：行動生成 4章 createRng、行動生成とプロンプトの設計 3・4章）
// 同じ種と salt からは同じ乱数列が出る（NFR-O-011、NFR-L-003）

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 文字列の FNV-1a（32 ビット）。UTF-8 のバイト列にかける */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** mulberry32。0 以上 1 未満の数を返す関数を作る */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 巡の乱数の種（generation_events.cycle_seed）と salt（エージェント ID など）から乱数を作る。
 * salt の FNV-1a ハッシュを種と XOR して mulberry32 に渡す。
 */
export function createRng(seed: number, salt: string): () => number {
  return mulberry32((seed ^ fnv1a32(salt)) >>> 0);
}
