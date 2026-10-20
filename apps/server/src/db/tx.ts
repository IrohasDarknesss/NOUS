// withTx：better-sqlite3 の transaction の包み（BE 詳細設計 admin_auth 1章）
// better-sqlite3 は同期なので、中で await しない。LLM の呼び出しなどはトランザクションの外で行う
import type { Db } from "./client";

/** withTx の中で使う DB（Drizzle のトランザクション） */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** DB とトランザクションのどちらでも受ける関数の引数の型（recordAudit など） */
export type DbOrTx = Db | Tx;

const isPromiseLike = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/**
 * fn を1つのトランザクションで実行する。fn が投げたら全体を取り消し、エラーをそのまま投げ直す。
 * 書き込みを前提に BEGIN IMMEDIATE で始める（WAL で読み取りは止めない。ロックの待ちは busy_timeout まで）。
 */
export function withTx<T>(db: Db, fn: (tx: Tx) => T): T {
  return db.transaction(
    (tx) => {
      const result = fn(tx);
      if (isPromiseLike(result)) {
        throw new TypeError("withTx の中で非同期の処理は使えません（better-sqlite3 のトランザクションは同期）");
      }
      return result;
    },
    { behavior: "immediate" },
  );
}
