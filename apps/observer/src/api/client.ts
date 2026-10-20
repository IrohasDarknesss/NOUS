import type { ApiErrorBody, ErrorCode } from "./types";

/** 401（招待なし・失効）。/not-invited へ移したあとに投げる */
export class NotInvitedError extends Error {
  constructor() {
    super("VIEW_NOT_INVITED");
    this.name = "NotInvitedError";
  }
}

/** 2xx 以外の応答。本文の error.code を持つ */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** サーバーに届かなかった */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("network error", { cause });
    this.name = "NetworkError";
  }
}

/** 閲覧できませんへ置き換える（履歴に残さない。P106 の E02） */
export function navigateToNotInvited(): void {
  window.location.replace("/not-invited");
}

/** fetchJson が 401 で呼ぶ遷移。テストで差し替えられるようにまとめて持つ */
export const navigation = { toNotInvited: navigateToNotInvited };

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin" });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (res.status === 401) {
    navigation.toNotInvited();
    throw new NotInvitedError();
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    if (isApiErrorBody(body)) throw new ApiError(res.status, body.error.code, body.error.message);
    throw new ApiError(res.status, null, `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
