// P211 世界のアーカイブ（FE 詳細設計 admin_moderation 2章〜6章）
import type { AdminPostItem, GenerationItem, GenerationPage, PostPage, WorldItem } from "@nous/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { getArchiveGenerations, getArchivePosts, listWorlds } from "../api/worlds";
import { colors, fontSizes } from "../shared/theme";
import { useApiErrorHandler } from "../shared/useApiErrorHandler";
import { ArchiveGenerationTable } from "./worlds/ArchiveGenerationTable";
import { ArchivePostTable } from "./worlds/ArchivePostTable";
import { ArchiveTabs, type ArchiveTab } from "./worlds/ArchiveTabs";
import { ReadOnlyBanner } from "./worlds/ReadOnlyBanner";
import { WorldTable } from "./worlds/WorldTable";

export const WORLD_NOT_FOUND_MESSAGE = "この世界は見つかりません";

export function useArchiveParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const worldId = searchParams.get("worldId") || null;
  const rawTab = searchParams.get("tab");
  const tab: ArchiveTab = rawTab === "generations" ? "generations" : "posts";

  const set = useCallback(
    (next: { worldId?: string | null; tab?: ArchiveTab }) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          const nextWorldId = "worldId" in next ? next.worldId : prev.get("worldId") || null;
          const nextTab: ArchiveTab = next.tab ?? (prev.get("tab") === "generations" ? "generations" : "posts");

          if (nextWorldId) updated.set("worldId", nextWorldId);
          else updated.delete("worldId");

          if (nextWorldId && nextTab === "generations") updated.set("tab", "generations");
          else updated.delete("tab");

          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { worldId, tab, set };
}

export function useWorlds() {
  return useQuery({
    queryKey: ["admin", "worlds"] as const,
    queryFn: listWorlds,
  });
}

export function useArchive(worldId: string | null, tab: ArchiveTab) {
  return useInfiniteQuery({
    queryKey: ["admin", "archive", worldId, tab] as const,
    enabled: Boolean(worldId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<PostPage | GenerationPage> => {
      if (!worldId) throw new Error("worldId is required");
      return tab === "generations"
        ? getArchiveGenerations(worldId, { cursor: pageParam })
        : getArchivePosts(worldId, { cursor: pageParam });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function WorldArchivePage() {
  const { worldId, tab, set } = useArchiveParams();
  const worldsQuery = useWorlds();
  const archiveQuery = useArchive(worldId, tab);
  const handleApiError = useApiErrorHandler();
  const navigate = useNavigate();
  const archiveSectionRef = useRef<HTMLDivElement | null>(null);

  const isWorldNotFound =
    archiveQuery.error instanceof ApiError &&
    (archiveQuery.error.code === "WORLD_NOT_FOUND" || archiveQuery.error.status === 404);

  useEffect(() => {
    const err = worldsQuery.error;
    if (err) handleApiError(err);
  }, [worldsQuery.error, handleApiError]);

  useEffect(() => {
    const err = archiveQuery.error;
    if (!err || isWorldNotFound) return;
    handleApiError(err);
  }, [archiveQuery.error, isWorldNotFound, handleApiError]);

  const worlds = useMemo(() => worldsQuery.data?.items ?? [], [worldsQuery.data]);
  const selectedWorld = useMemo(
    () => (worldId ? (worlds.find((w) => w.worldId === worldId) ?? null) : null),
    [worlds, worldId],
  );

  const openWorld = (world: WorldItem) => {
    if (world.state !== "archived") return;
    set({ worldId: world.worldId, tab: "posts" });
    archiveSectionRef.current?.scrollIntoView?.({ behavior: "smooth" });
  };

  if (isWorldNotFound) {
    return (
      <section style={{ textAlign: "center", padding: "48px 0" }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
          <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>{WORLD_NOT_FOUND_MESSAGE}</h1>
          <span style={{ color: colors.subText, fontSize: 12 }}>P211</span>
        </div>
        <p style={{ margin: "16px 0 0" }}>
          <Link to="/worlds" style={{ color: colors.primary }}>
            世界の一覧へ戻る
          </Link>
        </p>
      </section>
    );
  }

  const archiveItems = archiveQuery.data?.pages.flatMap((p): (AdminPostItem | GenerationItem)[] => p.items) ?? [];

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>世界のアーカイブ</h1>
        <span style={{ color: colors.subText, fontSize: 12 }}>P211</span>
      </div>

      <WorldTable items={worlds} onOpen={openWorld} />

      {worldId && (
        <div ref={archiveSectionRef} style={{ marginTop: 24 }}>
          <ReadOnlyBanner world={selectedWorld} />
          <ArchiveTabs tab={tab} onChange={(nextTab) => set({ worldId, tab: nextTab })} />
          {tab === "posts" ? (
            <ArchivePostTable
              items={archiveItems as AdminPostItem[]}
              onLoadMore={archiveQuery.hasNextPage ? () => void archiveQuery.fetchNextPage() : undefined}
              loadingMore={archiveQuery.isFetchingNextPage}
            />
          ) : (
            <ArchiveGenerationTable
              items={archiveItems as GenerationItem[]}
              onRowClick={(eventId) => navigate(`/generations/${encodeURIComponent(eventId)}`)}
              onLoadMore={archiveQuery.hasNextPage ? () => void archiveQuery.fetchNextPage() : undefined}
              loadingMore={archiveQuery.isFetchingNextPage}
            />
          )}
        </div>
      )}
    </section>
  );
}
