import { useState } from "react";
import { getThread } from "../../api/endpoints";
import type { ThreadNode } from "../../api/types";
import { useBanner } from "../../layout/ObserverLayout";
import { colors } from "../../lib/theme";

interface Props {
  postId: string;
  focusPostId: string;
  count: number;
  onLoaded: (postId: string, children: ThreadNode[]) => void;
}

/** 深さの上限で省略された返信を読み込むボタン */
export function ShowMoreReplies({ postId, focusPostId, count, onLoaded }: Props) {
  const [loading, setLoading] = useState(false);
  const { reportApiError } = useBanner();

  const loadMoreReplies = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await getThread(focusPostId, { from: postId, depth: 5 });
      onLoaded(postId, res.root.children);
    } catch (error) {
      reportApiError(error, { banner: "続きを読み込めませんでした" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void loadMoreReplies()}
      disabled={loading}
      style={{
        padding: "6px 12px",
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        background: colors.surface,
        color: colors.primary,
        fontSize: 13,
        cursor: loading ? "default" : "pointer",
      }}
    >
      続きを表示（{count} 件）
    </button>
  );
}
