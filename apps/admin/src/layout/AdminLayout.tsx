// 管理画面の枠：サイドメニュー・ヘッダー・メイン（最大幅 1200px）・ErrorBanner・ErrorModal・Toast の置き場所
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { ErrorBanner } from "../shared/ErrorBanner";
import { ErrorProvider, useErrorState } from "../shared/ErrorContext";
import { ErrorModal } from "../shared/ErrorModal";
import { colors, fontFamily, fontSizes } from "../shared/theme";
import { ToastProvider } from "../shared/Toast";
import { useSession } from "../session/SessionProvider";
import { AdminHeader } from "./AdminHeader";
import { AdminSideMenu } from "./AdminSideMenu";

function LayoutBody({ children }: { children?: ReactNode }) {
  const { banner, clearBanner, modal, closeModal } = useErrorState();
  const { clearSession } = useSession();

  const handleModalClose = () => {
    // 401 の後は /login へ移る前にセッションを捨てる（ログイン済みとして戻されないように）
    if (modal?.redirectTo === "/login") clearSession();
    closeModal();
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        minWidth: 1024,
        background: colors.background,
        color: colors.text,
        fontFamily,
        fontSize: fontSizes.body,
      }}
    >
      <AdminSideMenu />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AdminHeader />
        <ErrorBanner message={banner} onClose={clearBanner} />
        <main style={{ width: "100%", maxWidth: 1200, boxSizing: "border-box", padding: 24 }}>
          {children ?? <Outlet />}
        </main>
      </div>
      <ErrorModal message={modal?.message ?? null} redirectTo={modal?.redirectTo} onClose={handleModalClose} />
    </div>
  );
}

export function AdminLayout({ children }: { children?: ReactNode }) {
  return (
    <ErrorProvider>
      <ToastProvider>
        <LayoutBody>{children}</LayoutBody>
      </ToastProvider>
    </ErrorProvider>
  );
}
