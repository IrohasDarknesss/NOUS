/** sleep の待ちが signal の abort で打ち切られた（BE 詳細設計 world 4章・generation 2章） */
export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

/** 設定の誤りで起動を止める（production で AISNS_CLOCK=fake など。world 6章） */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
