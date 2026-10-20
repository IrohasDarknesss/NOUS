// adminFetch：管理 API の呼び出し（CSRF の付与、401 の処理、エラーの変換）。FE 詳細設計 admin_control 4章。
import type { ApiErrorBody, ErrorCode } from "@nous/shared";
import { CSRF_HEADER_NAME } from "@nous/shared";
import { getCsrfToken, setCsrfToken } from "../session/csrfToken";

/** API が 2xx 以外を返したときのエラー */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "UNKNOWN";
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: ErrorCode | "UNKNOWN", message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** 通信そのものの失敗（サーバーに届かない・応答が JSON でない） */
export class NetworkError extends Error {
  constructor(message = "通信に失敗しました") {
    super(message);
    this.name = "NetworkError";
  }
}

export interface AdminFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** false で X-CSRF-Token を付けない（login だけ）。既定は GET 以外で付ける */
  csrf?: boolean;
  signal?: AbortSignal;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && "code" in error;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function adminFetch<T>(path: string, options: AdminFetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const useCsrf = options.csrf ?? method !== "GET";
  if (useCsrf) {
    const token = getCsrfToken();
    if (token) headers[CSRF_HEADER_NAME] = token;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new NetworkError();
  }

  if (res.status === 204) return undefined as T;

  const data = await readJson(res);
  if (res.ok) {
    if (data === undefined) throw new NetworkError("応答を読み取れませんでした");
    return data as T;
  }

  if (isApiErrorBody(data)) {
    const { code, message, fields } = data.error;
    // セッション切れ：手元の CSRF トークンは使えないので捨てる。画面の遷移は useApiErrorHandler が行う
    if (res.status === 401 && code === "ADMIN_UNAUTHORIZED") setCsrfToken(null);
    throw new ApiError(res.status, code, message, fields);
  }
  throw new ApiError(res.status, res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN", res.statusText);
}
