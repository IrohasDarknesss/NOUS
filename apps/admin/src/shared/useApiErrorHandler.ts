// API のエラーを様式①〜④に振り分ける（FE 詳細設計 admin_control 4章・6章）
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError, NetworkError } from "../api/client";
import { useSession } from "../session/SessionProvider";
import { useErrorState } from "./ErrorContext";

export type FieldErrors = Record<string, string>;

export interface ApiErrorContext {
  /** 409 のときに様式②に出す画面ごとの文言（なければサーバーの message） */
  conflictMessage?: string | ((error: ApiError) => string);
  /** 409 のときに再取得するクエリ */
  invalidateKeys?: readonly QueryKey[];
}

export const MESSAGES = {
  sessionExpired: "ログインの有効期限が切れました。もう一度ログインしてください",
  csrfRetry: "操作をやり直してください",
  serverError: "操作に失敗しました。状態を確かめてからやり直してください",
} as const;

/** 400 のときに FieldError に出す項目。fields がなければ "_form" に message を入れる */
export const FORM_ERROR_KEY = "_form";

export function useApiErrorHandler(): (error: unknown, ctx?: ApiErrorContext) => FieldErrors | void {
  const { showBanner, showModal } = useErrorState();
  const { bootstrapSession } = useSession();
  const queryClient = useQueryClient();

  return useCallback(
    (error: unknown, ctx: ApiErrorContext = {}) => {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          showModal({ message: MESSAGES.sessionExpired, redirectTo: "/login" });
          return;
        }
        if (error.status === 403 && error.code === "CSRF_INVALID") {
          void bootstrapSession().finally(() => showBanner(MESSAGES.csrfRetry));
          return;
        }
        if (error.status === 409) {
          const msg =
            typeof ctx.conflictMessage === "function"
              ? ctx.conflictMessage(error)
              : (ctx.conflictMessage ?? error.message);
          showBanner(msg);
          for (const key of ctx.invalidateKeys ?? []) void queryClient.invalidateQueries({ queryKey: key });
          return;
        }
        if (error.status === 400) {
          return error.fields && Object.keys(error.fields).length > 0
            ? { ...error.fields }
            : { [FORM_ERROR_KEY]: error.message };
        }
        if (error.status >= 500) {
          showModal({ message: MESSAGES.serverError });
          return;
        }
        // 404・429 など画面で扱わなかったもの
        showBanner(error.message);
        return;
      }
      if (error instanceof NetworkError) {
        showModal({ message: MESSAGES.serverError });
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") return;
      showModal({ message: MESSAGES.serverError });
    },
    [showBanner, showModal, bootstrapSession, queryClient],
  );
}
