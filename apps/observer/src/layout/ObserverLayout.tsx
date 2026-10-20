import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, NotInvitedError } from "../api/client";
import { FullPageError } from "../components/FullPageError";
import { colors, contentMaxWidth, fontFamily } from "../lib/theme";
import { AiNoticeBand } from "./AiNoticeBand";
import { ErrorBanner } from "./ErrorBanner";
import { ObserverHeader } from "./ObserverHeader";
import { WorldStatusFooter } from "./WorldStatusFooter";

export interface ApiErrorMessages {
  /** 様式②に出す画面ごとの文言 */
  banner: string;
  /** 404 のときの様式③の見出し（例:「この投稿は見つかりません」）。無ければ「ページが見つかりません」 */
  notFound?: string;
}

interface BannerContextValue {
  bannerMessage: string | null;
  setBanner: (message: string | null) => void;
  reportApiError: (error: unknown, messages: ApiErrorMessages) => void;
}

const BannerContext = createContext<BannerContextValue | null>(null);

/** ページ・フックから様式②のバナーと API のエラーを扱う */
export function useBanner(): BannerContextValue {
  const value = useContext(BannerContext);
  if (!value) throw new Error("useBanner は ObserverLayout の中で使う");
  return value;
}

interface Props {
  children: ReactNode;
  /** P106 用。ヘッダーのリンクとフッターを出さない（世界の状態を取りに行かない） */
  minimal?: boolean;
}

/** ヘッダー・AI の帯・バナー・メイン（最大幅 640px）・フッター */
export function ObserverLayout({ children, minimal = false }: Props) {
  const [bannerMessage, setBanner] = useState<string | null>(null);
  const [notFoundTitle, setNotFoundTitle] = useState<string | null>(null);
  const { pathname } = useLocation();

  // 画面を移ったら前の画面のエラー表示は消す
  useEffect(() => {
    setBanner(null);
    setNotFoundTitle(null);
  }, [pathname]);

  const reportApiError = useCallback((error: unknown, messages: ApiErrorMessages) => {
    if (error instanceof NotInvitedError) return; // fetchJson が /not-invited へ移している
    if (error instanceof ApiError && error.status === 404) {
      setNotFoundTitle(messages.notFound ?? "ページが見つかりません");
      return;
    }
    setBanner(messages.banner);
  }, []);

  const value = useMemo(() => ({ bannerMessage, setBanner, reportApiError }), [bannerMessage, reportApiError]);

  return (
    <BannerContext.Provider value={value}>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          background: colors.background,
          color: colors.text,
          fontFamily,
        }}
      >
        <ObserverHeader linkDisabled={minimal} />
        <AiNoticeBand />
        <ErrorBanner message={bannerMessage} />
        <main
          style={{
            flex: 1,
            width: "100%",
            maxWidth: contentMaxWidth,
            margin: "0 auto",
            padding: "16px",
            boxSizing: "border-box",
          }}
        >
          {notFoundTitle ? <FullPageError title={notFoundTitle} linkToTimeline /> : children}
        </main>
        {!minimal && <WorldStatusFooter />}
      </div>
    </BannerContext.Provider>
  );
}
