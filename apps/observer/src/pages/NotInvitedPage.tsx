import { useEffect } from "react";
import { colors } from "../lib/theme";

const PAGE_TITLE = "閲覧できません - NOUS";

/** P106 閲覧できません（/not-invited） */
export function NotInvitedPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = PAGE_TITLE;

    let robotsMeta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const createdMeta = !robotsMeta;
    const prevContent = robotsMeta?.getAttribute("content") ?? null;
    if (!robotsMeta) {
      robotsMeta = document.createElement("meta");
      robotsMeta.setAttribute("name", "robots");
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.setAttribute("content", "noindex");

    return () => {
      document.title = prevTitle;
      if (createdMeta) {
        robotsMeta?.remove();
      } else if (prevContent !== null) {
        robotsMeta?.setAttribute("content", prevContent);
      }
    };
  }, []);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        textAlign: "center",
        padding: "32px 16px",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0, color: colors.text }}>このページは閲覧できません</h1>
      <p style={{ margin: 0, color: colors.text }}>閲覧には、管理者から受け取った招待リンクが必要です</p>
      <p style={{ margin: 0, color: colors.text }}>招待リンクを開き直してください</p>
      <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>招待が取り消された場合は、管理者に連絡してください</p>
    </section>
  );
}
