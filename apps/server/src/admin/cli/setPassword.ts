// 管理者のパスワードを端末から設定する CLI（BE 詳細設計 admin_auth 4章 setPasswordCli・6章 トランザクション制御）
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createClock, type Clock } from "../../clock/clock";
import { closeDb, openDb, resolveDbPath, type Db } from "../../db/client";
import { admin_account, admin_sessions } from "../../db/schema";
import { withTx } from "../../db/tx";
import { loadEnv } from "../../lib/env";
import { newUlid } from "../../lib/ids";
import { findAdmin } from "../auth/authService";
import { hashPassword } from "../auth/passwordHasher";

export const DEFAULT_ADMIN_DISPLAY_NAME = "Kaine Yamashiro";
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** 2回入力されたパスワードの一致と長さ（12〜128 字）を確かめる。パスワードの値はメッセージに含めない */
export function validatePasswordInput(first: string, second: string): ValidationResult {
  if (first !== second) {
    return { ok: false, reason: "パスワードが一致しません" };
  }
  if (first.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `パスワードは ${PASSWORD_MIN_LENGTH} 字以上で入力してください` };
  }
  if (first.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `パスワードは ${PASSWORD_MAX_LENGTH} 字以内で入力してください` };
  }
  return { ok: true };
}

export interface SetAdminPasswordResult {
  adminId: string;
  created: boolean;
}

/**
 * 管理者のパスワードをハッシュして保存し、既存の管理セッションをすべて削除する。
 * admin_account がなければ INSERT（表示名 Kaine Yamashiro）、あれば password_hash を UPDATE し
 * failed_count=0・locked_until=NULL に戻す。scrypt は withTx の外で計算する。
 */
export async function setAdminPassword(db: Db, clock: Clock, password: string): Promise<SetAdminPasswordResult> {
  const passwordHash = await hashPassword(password);
  return withTx(db, (tx) => {
    const nowIso = clock.nowIso();
    const existing = findAdmin(tx);
    let adminId: string;
    let created: boolean;

    if (!existing) {
      adminId = newUlid(clock.nowMs());
      created = true;
      tx.insert(admin_account)
        .values({
          admin_id: adminId,
          display_name: DEFAULT_ADMIN_DISPLAY_NAME,
          password_hash: passwordHash,
          failed_count: 0,
          locked_until: null,
          updated_at: nowIso,
        })
        .run();
    } else {
      adminId = existing.admin_id;
      created = false;
      tx.update(admin_account)
        .set({
          password_hash: passwordHash,
          failed_count: 0,
          locked_until: null,
          updated_at: nowIso,
        })
        .where(eq(admin_account.admin_id, existing.admin_id))
        .run();
    }

    tx.delete(admin_sessions).run();

    return { adminId, created };
  });
}

/** 標準入力から2行をエコーなしで読む */
export function readTwoPasswordsHidden(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<[string, string]> {
  const mutableOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const rl = createInterface({
    input,
    output: mutableOutput,
    terminal: true,
  });

  const lineQueue: string[] = [];
  let waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;
  let abortedError: Error | null = null;

  rl.on("line", (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      output.write("\n");
      w.resolve(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.on("SIGINT", () => {
    abortedError = new Error("パスワードの入力が中断されました");
    if (waiter) {
      const w = waiter;
      waiter = null;
      output.write("\n");
      w.reject(abortedError);
    }
    rl.close();
  });

  rl.on("close", () => {
    if (!abortedError) {
      abortedError = new Error("パスワードの入力が途中で終了しました");
    }
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.reject(abortedError);
    }
  });

  const askHidden = (promptText: string): Promise<string> =>
    new Promise<string>((resolveLine, rejectLine) => {
      output.write(promptText);
      const queued = lineQueue.shift();
      if (queued !== undefined) {
        output.write("\n");
        resolveLine(queued);
        return;
      }
      if (abortedError) {
        rejectLine(abortedError);
        return;
      }
      waiter = { resolve: resolveLine, reject: rejectLine };
    });

  return (async () => {
    try {
      const first = await askHidden("新しいパスワード（12〜128 字）: ");
      const second = await askHidden("新しいパスワード（確認）: ");
      return [first, second];
    } finally {
      rl.close();
    }
  })();
}

export interface SetPasswordCliIO {
  readPasswords?: () => Promise<[string, string]>;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  env?: Record<string, string | undefined>;
}

/** CLI のエントリポイント（終了コードを返す。パスワードの値はどこにも出力しない） */
export async function setPasswordCli(io: SetPasswordCliIO = {}): Promise<number> {
  const readPasswords = io.readPasswords ?? (() => readTwoPasswordsHidden());
  const writeOut = io.stdout ?? ((msg: string) => process.stdout.write(`${msg}\n`));
  const writeErr = io.stderr ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const [first, second] = await readPasswords();
  const validation = validatePasswordInput(first, second);
  if (!validation.ok) {
    writeErr(validation.reason);
    return 1;
  }

  const env = loadEnv(io.env ?? process.env);
  const clock = createClock(io.env ?? process.env);
  const db = openDb(resolveDbPath(env.dbPath));
  try {
    await setAdminPassword(db, clock, first);
    writeOut("管理者のパスワードを設定しました");
    return 0;
  } finally {
    closeDb(db);
  }
}

const isMain = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const selfPath = realpathSync(resolve(fileURLToPath(import.meta.url)));
    const entryPath = realpathSync(resolve(entry));
    return selfPath === entryPath;
  } catch {
    return false;
  }
};

if (isMain()) {
  setPasswordCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write("パスワードの設定に失敗しました\n");
      process.exitCode = 1;
    });
}
