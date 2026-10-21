// P208 生成ログ詳細：生成された投稿と「非表示管理で開く」（FE 詳細設計 admin_agents_logs 2章・4章、画面基本設計書 P208 4章）
import type { ResultPost, Visibility } from "@nous/shared";
import { Link, useNavigate } from "react-router-dom";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "公開",
  hidden: "非表示",
};

export function buildModerationPath(postId: string): string {
  return `/moderation?postId=${encodeURIComponent(postId)}`;
}

export function openModeration(postId: string, navigate: (to: string) => void): void {
  navigate(buildModerationPath(postId));
}

export interface ResultPostCardProps {
  post: ResultPost | null;
}

export function ResultPostCard({ post }: ResultPostCardProps) {
  const navigate = useNavigate();

  return (
    <section
      aria-label="生成された投稿"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>生成された投稿</h2>
      {!post ? (
        <p style={{ margin: 0, color: colors.subText }}>なし</p>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: colors.subText }}>
              投稿 ID：<code style={{ fontFamily: "monospace" }}>{post.postId}</code> ／ 公開状態：
              <strong>{VISIBILITY_LABELS[post.visibility]}</strong>
            </div>
            <Link
              to={buildModerationPath(post.postId)}
              onClick={(e) => {
                e.preventDefault();
                openModeration(post.postId, navigate);
              }}
              style={{ ...buttonStyle, textDecoration: "none" }}
            >
              非表示管理で開く
            </Link>
          </div>
          <p
            data-testid="result-post-body"
            style={{
              margin: 0,
              padding: 12,
              background: "#F8FAFC",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              whiteSpace: "pre-wrap",
            }}
          >
            {post.body}
          </p>
        </div>
      )}
    </section>
  );
}
