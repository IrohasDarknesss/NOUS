// P202 実行制御（画面基本設計書 P202、FE 詳細設計 admin_control 2〜6章）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client";
import {
  adminAuditQueryKey,
  adminWorldQueryKey,
  emergencyStop,
  getAuditLogs,
  pause,
  reset,
  resume,
  start,
  useAdminWorld,
} from "../api/world";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { colors, fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { FORM_ERROR_KEY, useApiErrorHandler } from "../shared/useApiErrorHandler";
import { ControlButtons, type ControlAction } from "./runControl/ControlButtons";
import { RecentAuditTable } from "./runControl/RecentAuditTable";
import { ResetDialog } from "./runControl/ResetDialog";
import { UsageCard } from "./runControl/UsageCard";
import { WorldStatusCard } from "./runControl/WorldStatusCard";

interface ConfirmState {
  action: Exclude<ControlAction, "pause" | "reset">;
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}

function conflictMessageFor(error: ApiError): string {
  if (error.code === "STATE_CONFLICT") {
    return "世界の状態が変わったため、操作できませんでした。最新の状態を表示します";
  }
  if (error.code === "NO_AGENTS") {
    return "エージェントが登録されていません。先にエージェントを登録してください";
  }
  if (error.code === "GENERATION_RUNNING") {
    return "実行中の生成があります。終わってから操作してください";
  }
  return error.message;
}

export function RunControlPage() {
  const { world } = useAdminWorld();
  const auditQuery = useQuery({
    queryKey: adminAuditQueryKey,
    queryFn: () => getAuditLogs(10),
    retry: false,
  });
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const handleApiError = useApiErrorHandler();

  const [pendingAction, setPendingAction] = useState<ControlAction | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const invalidateWorldAndAudit = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminWorldQueryKey }),
      queryClient.invalidateQueries({ queryKey: adminAuditQueryKey }),
    ]);
  };

  const runAction = async (action: Exclude<ControlAction, "reset">) => {
    setPendingAction(action);
    try {
      if (action === "start") {
        await start();
        await invalidateWorldAndAudit();
        showToast("開始しました");
      } else if (action === "pause") {
        await pause();
        await invalidateWorldAndAudit();
        showToast("一時停止しました。実行中の生成は最大 60 秒で終わります");
      } else if (action === "resume") {
        await resume();
        await invalidateWorldAndAudit();
        showToast("再開しました");
      } else if (action === "emergency") {
        const res = await emergencyStop();
        await invalidateWorldAndAudit();
        showToast(`緊急停止しました。取り消した生成 ${res.cancelledGenerations} 件`);
      }
      setConfirm(null);
    } catch (e) {
      setConfirm(null);
      handleApiError(e, {
        conflictMessage: conflictMessageFor,
        invalidateKeys: [adminWorldQueryKey, adminAuditQueryKey],
      });
    } finally {
      setPendingAction(null);
    }
  };

  const requestAction = (action: ControlAction) => {
    if (action === "pause") {
      void runAction("pause");
      return;
    }
    if (action === "start") {
      setConfirm({
        action: "start",
        title: "世界の開始",
        message: "世界を開始します。よろしいですか",
        confirmLabel: "開始する",
        danger: false,
      });
      return;
    }
    if (action === "resume") {
      if (world?.state === "emergency_stopped") {
        setConfirm({
          action: "resume",
          title: "緊急停止からの再開",
          message: "状況を確認しましたか",
          confirmLabel: "再開する",
          danger: false,
        });
      } else {
        void runAction("resume");
      }
      return;
    }
    if (action === "emergency") {
      setConfirm({
        action: "emergency",
        title: "緊急停止",
        message: "実行中の生成を取り消して止めます",
        confirmLabel: "緊急停止する",
        danger: true,
      });
      return;
    }
    if (action === "reset") {
      setResetOpen(true);
    }
  };

  const handleResetConfirm = async (confirmName: string): Promise<string | null> => {
    setPendingAction("reset");
    try {
      await reset({ confirmName });
      await invalidateWorldAndAudit();
      setResetOpen(false);
      showToast("リセットしました。前の世界はアーカイブにあります");
      return null;
    } catch (e) {
      const fields = handleApiError(e, {
        conflictMessage: conflictMessageFor,
        invalidateKeys: [adminWorldQueryKey, adminAuditQueryKey],
      });
      if (fields) {
        return fields.confirmName ?? fields[FORM_ERROR_KEY] ?? "世界の名前が一致しません";
      }
      setResetOpen(false);
      return null;
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>実行制御</h1>
        <span style={{ fontSize: 12, color: colors.subText }}>P202</span>
      </div>

      {!world ? (
        <p style={{ color: colors.subText }}>世界の状態を読み込み中…</p>
      ) : (
        <>
          <WorldStatusCard world={world} />
          <UsageCard usage={world.usage} runningGenerations={world.runningGenerations} />
          <ControlButtons
            state={world.state}
            agentCount={world.agentCounts.active}
            pending={pendingAction}
            onAction={requestAction}
          />
          <RecentAuditTable items={auditQuery.data?.items ?? []} />

          {confirm && (
            <ConfirmDialog
              title={confirm.title}
              message={confirm.message}
              confirmLabel={confirm.confirmLabel}
              danger={confirm.danger}
              onConfirm={() => runAction(confirm.action)}
              onCancel={() => setConfirm(null)}
            />
          )}

          {resetOpen && (
            <ResetDialog worldName={world.name} onConfirm={handleResetConfirm} onCancel={() => setResetOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}
