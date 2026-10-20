import type { ThreadNode } from "../../api/types";
import { AgentName } from "../../components/AgentName";
import { colors } from "../../lib/theme";
import { formatWorldTime } from "../../lib/worldTime";
import { HiddenPostNotice } from "./HiddenPostNotice";
import { ShowMoreReplies } from "./ShowMoreReplies";

const MAX_INDENT_DEPTH = 5;
const INDENT_PX = 16;

interface Props {
  node: ThreadNode;
  depth: number;
  focusId: string;
  newIds?: ReadonlySet<string>;
  extraChildren?: Record<string, ThreadNode[]>;
  onLoaded?: (postId: string, children: ThreadNode[]) => void;
}

/** スレッドの投稿 1 件と子の返信を再帰で描画する */
export function ThreadNodeView({ node, depth, focusId, newIds, extraChildren, onLoaded }: Props) {
  const isFocused = node.postId === focusId;
  const isNew = newIds?.has(node.postId) ?? false;
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX;

  const hasExtra = extraChildren !== undefined && Object.prototype.hasOwnProperty.call(extraChildren, node.postId);
  const loadedChildren = hasExtra ? (extraChildren[node.postId] ?? []) : [];
  const children = hasExtra ? [...node.children, ...loadedChildren] : node.children;
  const showMore = node.moreCount >= 1 && !hasExtra;

  return (
    <div>
      <article
        data-post-id={node.postId}
        data-focused={isFocused ? "true" : undefined}
        style={{
          marginLeft: indent,
          marginBottom: 8,
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          borderLeft: isFocused ? `3px solid ${colors.primary}` : `1px solid ${colors.border}`,
          background: isNew ? "#FEF9C3" : isFocused ? "#EFF6FF" : colors.surface,
        }}
      >
        {node.hidden || !node.agent || node.body === null ? (
          <HiddenPostNotice />
        ) : (
          <>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <AgentName agent={node.agent} />
              <time style={{ color: colors.muted, fontSize: 13 }}>{formatWorldTime(node.worldTimeSec)}</time>
            </header>
            <p style={{ margin: "8px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: colors.text }}>
              {node.body}
            </p>
            <footer style={{ display: "flex", gap: 16, color: colors.muted, fontSize: 13 }}>
              <span>いいね {node.likeCount}</span>
            </footer>
          </>
        )}
      </article>
      {children.map((child) => (
        <ThreadNodeView
          key={child.postId}
          node={child}
          depth={depth + 1}
          focusId={focusId}
          newIds={newIds}
          extraChildren={extraChildren}
          onLoaded={onLoaded}
        />
      ))}
      {showMore && (
        <div style={{ marginLeft: Math.min(depth + 1, MAX_INDENT_DEPTH) * INDENT_PX, marginBottom: 8 }}>
          <ShowMoreReplies
            postId={node.postId}
            focusPostId={focusId}
            count={node.moreCount}
            onLoaded={onLoaded ?? (() => {})}
          />
        </div>
      )}
    </div>
  );
}
