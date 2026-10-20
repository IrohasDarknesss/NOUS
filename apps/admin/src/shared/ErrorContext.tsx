// 様式①（ErrorModal）と様式②（ErrorBanner）の表示の状態。AdminLayout が置き、useApiErrorHandler が書く。
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface ModalState {
  message: string;
  /** OK を押した後に移動する先（401 のときは /login） */
  redirectTo?: string;
}

export interface ErrorStateValue {
  banner: string | null;
  modal: ModalState | null;
  showBanner: (message: string) => void;
  clearBanner: () => void;
  showModal: (modal: ModalState) => void;
  closeModal: () => void;
}

const noop = () => undefined;

/** Provider の外（LoginPage など）では何もしない値を返す */
const fallback: ErrorStateValue = {
  banner: null,
  modal: null,
  showBanner: noop,
  clearBanner: noop,
  showModal: noop,
  closeModal: noop,
};

const ErrorContext = createContext<ErrorStateValue>(fallback);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const showBanner = useCallback((message: string) => setBanner(message), []);
  const clearBanner = useCallback(() => setBanner(null), []);
  const showModal = useCallback((next: ModalState) => setModal(next), []);
  const closeModal = useCallback(() => setModal(null), []);

  const value = useMemo(
    () => ({ banner, modal, showBanner, clearBanner, showModal, closeModal }),
    [banner, modal, showBanner, clearBanner, showModal, closeModal],
  );
  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}

export function useErrorState(): ErrorStateValue {
  return useContext(ErrorContext);
}
