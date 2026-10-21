// P208 生成ログ詳細：試行の表（FE 詳細設計 admin_agents_logs 2章、画面基本設計書 P208 4章）
import type { AttemptResult, GenerationAttempt } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors } from "../../shared/theme";

export const ATTEMPT_RESULT_LABELS: Record<AttemptResult, string> = {
  ok: "成功",
  timeout: "タイムアウト",
  rate_limited: "レート制限",
  server_error: "サーバーのエラー",
  invalid_format: "不正な形式",
  free_tier: "無料枠",
  cancelled: "取り消し",
};

export interface AttemptTableProps {
  attempts: readonly GenerationAttempt[];
}

export function AttemptTable({ attempts }: AttemptTableProps) {
  const columns: readonly DataTableColumn<GenerationAttempt>[] = [
    { key: "attemptNo", header: "番号", width: 60, align: "right", render: (r) => r.attemptNo },
    { key: "result", header: "結果", render: (r) => ATTEMPT_RESULT_LABELS[r.result] ?? r.result },
    { key: "httpStatus", header: "HTTP", align: "right", render: (r) => r.httpStatus ?? "―" },
    { key: "errorDetail", header: "エラーの内容", render: (r) => r.errorDetail ?? "―" },
    {
      key: "tokens",
      header: "トークン（入力 / 出力）",
      align: "right",
      render: (r) => `${r.promptTokens.toLocaleString("ja-JP")} / ${r.completionTokens.toLocaleString("ja-JP")}`,
    },
    { key: "neurons", header: "Neurons", align: "right", render: (r) => r.neurons.toFixed(1) },
    {
      key: "durationMs",
      header: "所要（ミリ秒）",
      align: "right",
      render: (r) => `${r.durationMs.toLocaleString("ja-JP")} ms`,
    },
  ];

  return (
    <section
      aria-label="試行"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>試行</h2>
      <DataTable
        columns={columns}
        rows={attempts}
        rowKey={(r) => String(r.attemptNo)}
        emptyMessage="試行はありません"
      />
    </section>
  );
}
