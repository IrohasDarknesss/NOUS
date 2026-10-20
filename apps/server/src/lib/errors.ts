// AppError とエラーコードの定数（BE 詳細設計 admin_auth 1章・6章、基本設計書 概要 4章「エラーの返し方」・7章）
// message は既定の文言。画面基本設計書に文言があるコードはそれに合わせ、ないものは汎用の文言にしている。

export const ERROR_CODES = {
  VALIDATION_ERROR: { status: 400, message: "入力の内容を確認してください" },
  CONFIRM_MISMATCH: { status: 400, message: "世界の名前が一致しません" },
  ADMIN_UNAUTHORIZED: { status: 401, message: "ログインしてください" },
  LOGIN_FAILED: { status: 401, message: "パスワードが正しくありません" },
  VIEW_NOT_INVITED: { status: 401, message: "招待リンクから開いてください" },
  CSRF_INVALID: { status: 403, message: "画面を再読み込みしてから、もう一度操作してください" },
  FORBIDDEN_NETWORK: { status: 403, message: "この端末のネットワークの外からは閲覧できません" },
  AGENT_NOT_FOUND: { status: 404, message: "この住人は見つかりません" },
  POST_NOT_FOUND: { status: 404, message: "この投稿は見つかりません" },
  EVENT_NOT_FOUND: { status: 404, message: "生成イベントが見つかりません" },
  WORLD_NOT_FOUND: { status: 404, message: "この世界は見つかりません" },
  INVITATION_NOT_FOUND: { status: 404, message: "この招待は見つかりません" },
  WRITE_NOT_ALLOWED: { status: 405, message: "この画面からは変更できません" },
  STATE_CONFLICT: { status: 409, message: "世界の状態が変わっています。最新の状態を読み直してください" },
  CONFLICT: { status: 409, message: "同じ内容がすでに登録されています" },
  ADMIN_NOT_SET: {
    status: 409,
    message: "管理者のパスワードが設定されていません。pnpm admin:set-password で設定してください",
  },
  NO_AGENTS: { status: 409, message: "エージェントが登録されていません。先にエージェントを登録してください" },
  GENERATION_RUNNING: { status: 409, message: "実行中の生成があります。終わってから操作してください" },
  HANDLE_TAKEN: { status: 409, message: "このハンドルは使われています" },
  ALREADY_STOPPED: { status: 409, message: "このエージェントはすでに停止しています" },
  ALREADY_ACTIVE: { status: 409, message: "このエージェントはすでに稼働しています" },
  ALREADY_HIDDEN: { status: 409, message: "この投稿はすでに非表示です" },
  NOT_HIDDEN: { status: 409, message: "この投稿は非表示ではありません" },
  ALREADY_REVOKED: { status: 409, message: "この招待はすでに失効しています" },
  LAN_ADDRESS_NOT_FOUND: {
    status: 409,
    message: "この端末の LAN のアドレスが見つかりません。端末がネットワークにつながっているか確かめてください",
  },
  LOGIN_LOCKED: { status: 429, message: "ログインの試行が続いたため、しばらく受け付けません" },
  INTERNAL_ERROR: { status: 500, message: "処理に失敗しました。時間をおいて再度お試しください" },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;
export type ErrorStatus = (typeof ERROR_CODES)[ErrorCode]["status"];
export type ErrorFields = Record<string, string>;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; fields: ErrorFields };
}

export interface AppErrorOptions {
  message?: string;
  fields?: ErrorFields;
  cause?: unknown;
}

/** 業務のエラー。errorHandler が status と code・message・fields をそのまま返す */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly fields: ErrorFields;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_CODES[code].message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.fields = options.fields ?? {};
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, fields: this.fields } };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** 設定の誤り（環境変数の不正、production での fake の時計など）。起動を止める */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`設定に誤りがあります: ${problems.join(" / ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}
