import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { SessionProvider } from "../session/SessionProvider";
import { mockFetch, sessionOk } from "../test/fetchMock";
import { createTestQueryClient } from "../test/renderApp";
import { ConfirmDialog } from "./ConfirmDialog";
import { DataTable } from "./DataTable";
import { ErrorBanner } from "./ErrorBanner";
import { ErrorProvider, useErrorState } from "./ErrorContext";
import { FieldError } from "./FieldError";
import { TextField } from "./TextField";
import { TOAST_DURATION_MS, ToastProvider, useToast } from "./Toast";
import { FORM_ERROR_KEY, MESSAGES, useApiErrorHandler } from "./useApiErrorHandler";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("共通部品", () => {
  it("TC-NOUS50_DEV-21 ErrorBanner・FieldError は message がなければ何も出さない", () => {
    const { container } = render(
      <>
        <ErrorBanner message={null} />
        <FieldError />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    render(<ErrorBanner message="最新の状態を取得できていません" />);
    expect(screen.getByRole("alert")).toHaveTextContent("最新の状態を取得できていません");
  });

  it("TC-NOUS50_DEV-22 ConfirmDialog は確定とキャンセルを呼び分け、送信中は押せない", async () => {
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="緊急停止"
        message="実行中の生成を取り消して止めます"
        confirmLabel="緊急停止する"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "緊急停止する" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "送信中…" })).toBeDisabled();
    await act(async () => resolve());
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("TC-NOUS50_DEV-23 トーストは 4 秒で消える", () => {
    vi.useFakeTimers();
    function Trigger() {
      const { showToast } = useToast();
      return (
        <button type="button" onClick={() => showToast("保存しました")}>
          送る
        </button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => screen.getByRole("button", { name: "送る" }).click());
    expect(screen.getByRole("status")).toHaveTextContent("保存しました");
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("TC-NOUS50_DEV-24 DataTable は 0 件で emptyMessage、行を押すと onRowClick", async () => {
    const onRowClick = vi.fn();
    const columns = [{ key: "name", header: "名前", render: (r: { id: string; name: string }) => r.name }];
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyMessage="まだありません" />,
    );
    expect(screen.getByText("まだありません")).toBeInTheDocument();
    rerender(
      <DataTable
        columns={columns}
        rows={[{ id: "1", name: "ミナト" }]}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        emptyMessage="まだありません"
      />,
    );
    await userEvent.click(screen.getByText("ミナト"));
    expect(onRowClick).toHaveBeenCalledWith({ id: "1", name: "ミナト" });
  });

  it("TC-NOUS50_DEV-25 TextField は文字数を出し、error を入力欄の下に出す", () => {
    render(
      <TextField label="ラベル" value="たなか" maxLength={30} error="入力してください" onChange={() => undefined} />,
    );
    expect(screen.getByText("3/30")).toBeInTheDocument();
    expect(screen.getByLabelText("ラベル")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("入力してください");
  });
});

describe("useApiErrorHandler", () => {
  function setup() {
    mockFetch({ "GET /admin/api/session": sessionOk });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionProvider>
            <ErrorProvider>{children}</ErrorProvider>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => ({ handle: useApiErrorHandler(), state: useErrorState() }), { wrapper });
    return { result, invalidate };
  }

  it("TC-NOUS50_DEV-26 401 は様式①（ログインの有効期限）で、OK の後に /login", () => {
    const { result } = setup();
    act(() => void result.current.handle(new ApiError(401, "ADMIN_UNAUTHORIZED", "x")));
    expect(result.current.state.modal).toEqual({ message: MESSAGES.sessionExpired, redirectTo: "/login" });
  });

  it("TC-NOUS50_DEV-27 409 は様式②に画面の文言を出し、指定のクエリを再取得する", () => {
    const { result, invalidate } = setup();
    act(
      () =>
        void result.current.handle(new ApiError(409, "STATE_CONFLICT", "server"), {
          conflictMessage: "世界の状態が変わりました",
          invalidateKeys: [["admin", "world"]],
        }),
    );
    expect(result.current.state.banner).toBe("世界の状態が変わりました");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "world"] });
  });

  it("TC-NOUS50_DEV-28 400 は fields を返し、fields がなければ _form に message", () => {
    const { result } = setup();
    expect(
      result.current.handle(
        new ApiError(400, "VALIDATION_ERROR", "x", { cycleMinutes: "15〜120 の整数で入力してください" }),
      ),
    ).toEqual({ cycleMinutes: "15〜120 の整数で入力してください" });
    expect(result.current.handle(new ApiError(400, "CONFIRM_MISMATCH", "世界の名前が一致しません"))).toEqual({
      [FORM_ERROR_KEY]: "世界の名前が一致しません",
    });
  });

  it("TC-NOUS50_DEV-29 500 と通信の失敗は様式①", () => {
    const { result } = setup();
    act(() => void result.current.handle(new ApiError(500, "INTERNAL_ERROR", "x")));
    expect(result.current.state.modal?.message).toBe(MESSAGES.serverError);
    act(() => result.current.state.closeModal());
    act(() => void result.current.handle(new NetworkError()));
    expect(result.current.state.modal?.message).toBe(MESSAGES.serverError);
  });

  it("TC-NOUS50_DEV-30 403 CSRF_INVALID はセッションを取り直してから様式②「操作をやり直してください」", async () => {
    const { result } = setup();
    await act(async () => {
      result.current.handle(new ApiError(403, "CSRF_INVALID", "x"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.banner).toBe(MESSAGES.csrfRetry);
  });
});
