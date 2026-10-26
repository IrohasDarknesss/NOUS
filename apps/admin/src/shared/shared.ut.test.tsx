// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_AWEB_ui.json
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { SessionProvider } from "../session/SessionProvider";
import { mockFetch, sessionOk } from "../test/fetchMock";
import { createTestQueryClient } from "../test/renderApp";
import { DataTable } from "./DataTable";
import { ErrorBanner } from "./ErrorBanner";
import { ErrorProvider, useErrorState } from "./ErrorContext";
import { ErrorModal } from "./ErrorModal";
import { NumberField } from "./NumberField";
import { SelectField } from "./SelectField";
import { TextField } from "./TextField";
import { TOAST_DURATION_MS, ToastProvider, useToast } from "./Toast";
import { FORM_ERROR_KEY, MESSAGES, useApiErrorHandler } from "./useApiErrorHandler";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setupHandler() {
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

describe("useApiErrorHandler（単体テスト）", () => {
  it("TC-UT_AWEB-027 409 で conflictMessage が関数ならエラーから文言を作り、指定がなければサーバーの message を様式②に出す", () => {
    const { result, invalidate } = setupHandler();

    act(() => {
      result.current.handle(new ApiError(409, "NO_AGENTS", "server-no-agents"), {
        conflictMessage: (e) => `画面:${e.code}`,
      });
    });
    const fromFunction = result.current.state.banner;
    act(() => {
      result.current.handle(new ApiError(409, "STATE_CONFLICT", "server-conflict"));
    });

    expect(fromFunction).toBe("画面:NO_AGENTS");
    expect(result.current.state.banner).toBe("server-conflict");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    [404, "AGENT_NOT_FOUND"],
    [429, "LOGIN_LOCKED"],
  ] as const)(
    "TC-UT_AWEB-028 画面で扱わない 4xx（404・429）はサーバーの message を様式②に出す（%j）",
    (status, code) => {
      const { result } = setupHandler();

      act(() => {
        result.current.handle(new ApiError(status, code, `server-${status}`));
      });

      expect(result.current.state.banner).toBe(`server-${status}`);
      expect(result.current.state.modal).toBeNull();
    },
  );

  it("TC-UT_AWEB-029 AbortError は何も出さず、ApiError・NetworkError 以外の例外は様式①にする", () => {
    const { result } = setupHandler();

    act(() => {
      result.current.handle(new DOMException("aborted", "AbortError"));
    });
    const afterAbort = { banner: result.current.state.banner, modal: result.current.state.modal };
    act(() => {
      result.current.handle(new Error("unexpected"));
    });

    expect(afterAbort).toEqual({ banner: null, modal: null });
    expect(result.current.state.modal?.message).toBe(MESSAGES.serverError);
  });

  it("TC-UT_AWEB-030 400 で fields が空のオブジェクトなら、_form に message を入れて返す", () => {
    const { result } = setupHandler();

    const fields = result.current.handle(new ApiError(400, "VALIDATION_ERROR", "入力の内容を確認してください", {}));

    expect(fields).toEqual({ [FORM_ERROR_KEY]: "入力の内容を確認してください" });
  });

  it("TC-UT_AWEB-031 ErrorProvider の外では、様式の表示の関数を呼んでも何もせず例外にしない", () => {
    const { result } = renderHook(() => useErrorState());

    const call = () => {
      result.current.showBanner("x");
      result.current.showModal({ message: "y" });
    };

    expect(call).not.toThrow();
    expect(result.current.banner).toBeNull();
  });
});

describe("表示の部品（単体テスト）", () => {
  it("TC-UT_AWEB-032 ErrorModal は redirectTo がなければ OK で閉じるだけで移動しない", async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<ErrorModal message="操作に失敗しました" onClose={onClose} />} />
          <Route path="/login" element={<p>LOGIN</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("LOGIN")).toBeNull();
  });

  it("TC-UT_AWEB-033 ErrorBanner は onClose があれば閉じるボタンを出して呼び、なければボタンを出さない", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<ErrorBanner message="最新の状態を取得できていません" onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    rerender(<ErrorBanner message="最新の状態を取得できていません" />);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
  });

  it("TC-UT_AWEB-034 トーストを 2 秒ずらして 2 つ出すと、それぞれ 4 秒で別々に消える", () => {
    vi.useFakeTimers();
    let show: (message: string) => void = () => undefined;
    function Trigger() {
      show = useToast().showToast;
      return null;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    act(() => show("1つ目"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => show("2つ目"));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 2000));
    const atFirstExpiry = screen.queryAllByRole("status").map((el) => el.textContent);
    act(() => vi.advanceTimersByTime(2000));

    expect(atFirstExpiry).toEqual(["2つ目"]);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("TC-UT_AWEB-035 NumberField は範囲と単位を出し、入力値を文字列のまま返し、error のときは aria-invalid を付ける", async () => {
    const onChange = vi.fn();
    render(
      <NumberField
        label="周期（分）"
        value=""
        min={15}
        max={120}
        unit="分"
        error="15〜120 の整数で入力してください"
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByLabelText("周期（分）"), "7");

    expect(screen.getByText("15〜120")).toBeInTheDocument();
    expect(screen.getByText("分")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith("7");
    expect(screen.getByLabelText("周期（分）")).toHaveAttribute("aria-invalid", "true");
  });

  it("TC-UT_AWEB-036 TextField は文字数をコードポイントで数え、上限を超えた数も出し、hideCount なら数を出さない", () => {
    const { rerender } = render(
      <TextField label="名前" value={"\u{1F600}a"} maxLength={1} onChange={() => undefined} />,
    );
    const overCount = screen.getByText("2/1");

    rerender(<TextField label="名前" value={"\u{1F600}a"} maxLength={1} hideCount onChange={() => undefined} />);

    expect(overCount).toBeInTheDocument();
    expect(screen.queryByText("2/1")).toBeNull();
  });

  it("TC-UT_AWEB-037 SelectField は選択肢を出し、選んだ値を onChange に渡す", async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="モデル"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value="a"
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("モデル"), "b");

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["A", "B"]);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("TC-UT_AWEB-039 TextField は multiline なら textarea を rows の行数で出す", () => {
    render(<TextField label="理由" value="" maxLength={200} multiline rows={5} onChange={() => undefined} />);

    const box = screen.getByLabelText("理由");

    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("rows", "5");
  });

  it("TC-UT_AWEB-040 DataTable は onRowClick がなければ行を押せる見た目にせず、押しても何も起きない", async () => {
    render(
      <DataTable
        columns={[{ key: "name", header: "名前", render: (r: { id: string }) => r.id }]}
        rows={[{ id: "row-1" }]}
        rowKey={(r) => r.id}
        emptyMessage="なし"
      />,
    );
    const row = screen.getByText("row-1").closest("tr") as HTMLElement;

    await userEvent.click(row);

    expect(row.style.cursor).toBe("");
  });
});
