import type { KeyboardEvent } from "react";
import type { PostView } from "../api/types";
import { colors } from "../lib/theme";
import { formatWorldTime } from "../lib/worldTime";
import { AgentName } from "./AgentName";
import { ReplyToLabel } from "./ReplyToLabel";

interface Props {
  post: PostView;
  onOpen: (postId: string) => void;
}

/** 投稿1件。本文はテキストとして描く（NFR-S-011）。いいね数は数だけで押せない（FR-106） */
export function PostCard({ post, onOpen }: Props) {
  const open = () => onOpen(post.postId);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open();
    }
  };
  return (
    <article
      data-post-id={post.postId}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 12,
        cursor: "pointer",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <AgentName agent={post.agent} />
        <time style={{ color: colors.muted, fontSize: 13 }}>{formatWorldTime(post.worldTimeSec)}</time>
      </header>
      {post.replyTo && <ReplyToLabel replyTo={post.replyTo} />}
      <p style={{ margin: "8px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: colors.text }}>
        {post.body}
      </p>
      <footer style={{ display: "flex", gap: 16, color: colors.muted, fontSize: 13 }}>
        <span>返信 {post.replyCount}</span>
        <span>いいね {post.likeCount}</span>
      </footer>
    </article>
  );
}
