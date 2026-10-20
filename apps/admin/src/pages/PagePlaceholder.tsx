// 仮のページ（中身は NOUS-69〜NOUS-72 で入れる）
import { colors } from "../shared/theme";

export interface PagePlaceholderProps {
  screenId: string;
  title: string;
}

export function PagePlaceholder({ screenId, title }: PagePlaceholderProps) {
  return (
    <section>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</h1>
      <p style={{ color: colors.subText, margin: 0 }}>{screenId}（準備中）</p>
    </section>
  );
}
