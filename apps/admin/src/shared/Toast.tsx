// 成功の通知（右下に 4 秒表示）
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { colors } from "./theme";

export const TOAST_DURATION_MS = 4000;

export interface Toast {
  id: number;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toasts: [], showToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const showToast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
    timers.current.add(timer);
  }, []);

  const value = useMemo(() => ({ toasts, showToast }), [toasts, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 1100,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              background: colors.sideMenu,
              color: "#FFFFFF",
              padding: "10px 16px",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.25)",
              maxWidth: 400,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
