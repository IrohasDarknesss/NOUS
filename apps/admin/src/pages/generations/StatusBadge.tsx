// P207・P208 生成ログの状態バッジ（FE 詳細設計 admin_agents_logs 2章、画面基本設計書 P207 4章）
import type { FailureKind, GenerationStatus } from "@nous/shared";
import { colors } from "../../shared/theme";

export const STATUS_LABELS: Record<GenerationStatus, string> = {
  succeeded: "成功",
  failed: "失敗",
  cancelled: "取り消し",
  interrupted: "中断",
  running: "実行中",
};

export const STATUS_COLORS: Record<GenerationStatus, string> = {
  succeeded: colors.success,
  failed: colors.danger,
  cancelled: "#EA580C",
  interrupted: colors.subText,
  running: colors.primary,
};

export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  timeout: "タイムアウト",
  rate_limited: "レート制限",
  server_error: "サーバーのエラー",
  invalid_format: "不正な形式",
  free_tier: "無料枠",
  cancelled: "取り消し",
  stopped: "停止",
  interrupted: "中断",
};

export function formatFailureKind(kind: FailureKind | null | undefined): string {
  if (!kind) return "―";
  return FAILURE_KIND_LABELS[kind] ?? kind;
}

export interface StatusBadgeProps {
  status: GenerationStatus;
  failureKind?: FailureKind | null;
}

export function StatusBadge({ status, failureKind }: StatusBadgeProps) {
  const showFailure = (status === "failed" || status === "cancelled" || status === "interrupted") && failureKind;
  return (
    <span
      data-status={status}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: STATUS_COLORS[status],
        color: "#FFFFFF",
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {STATUS_LABELS[status]}
      {showFailure && `（${formatFailureKind(failureKind)}）`}
    </span>
  );
}
