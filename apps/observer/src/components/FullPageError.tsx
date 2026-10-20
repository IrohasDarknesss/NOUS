import { Link } from "react-router-dom";
import { colors } from "../lib/theme";

interface Props {
  title: string;
  linkToTimeline: boolean;
}

/** 様式③（404・未知のパスなど、画面全体の切り替え） */
export function FullPageError({ title, linkToTimeline }: Props) {
  return (
    <section style={{ textAlign: "center", padding: "48px 0" }}>
      <h1 style={{ fontSize: 20, color: colors.text }}>{title}</h1>
      {linkToTimeline && (
        <p>
          <Link to="/" style={{ color: colors.primary }}>
            タイムラインへ
          </Link>
        </p>
      )}
    </section>
  );
}
