// P206 利用量・運用指標：日別の表（エラー率 5% 超を赤、クリックで P207）（FE 詳細設計 admin_agents_logs 2章・4章）
import type { DailyMetricsItem } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors } from "../../shared/theme";

const DAY_MS = 86_400_000;
export const ERROR_RATE_DANGER_THRESHOLD = 0.05;

/** 比率を百分率の小数 1 桁にする。null は「―」 */
export function formatRate(rate: number | null): string {
  if (rate === null) return "―";
  return `${(rate * 100).toFixed(1)}%`;
}

/** その利用日の失敗の生成ログ一覧（P207）への URL を作る */
export function buildFailedLogsPath(usageDate: string): string {
  const fromDate = new Date(`${usageDate}T00:00:00.000Z`);
  const toDate = new Date(fromDate.getTime() + DAY_MS);
  const params = new URLSearchParams({
    status: "failed",
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });
  return `/generations?${params.toString()}`;
}

export function openFailedLogs(usageDate: string, navigate: (to: string) => void): void {
  navigate(buildFailedLogsPath(usageDate));
}

export interface MetricsTableProps {
  items: readonly DailyMetricsItem[];
  onErrorRateClick: (usageDate: string) => void;
}

export function MetricsTable({ items, onErrorRateClick }: MetricsTableProps) {
  const columns: readonly DataTableColumn<DailyMetricsItem>[] = [
    { key: "usageDate", header: "利用日", render: (r) => r.usageDate },
    { key: "calls", header: "呼び出し", align: "right", render: (r) => r.calls.toLocaleString("ja-JP") },
    {
      key: "promptTokens",
      header: "入力トークン",
      align: "right",
      render: (r) => r.promptTokens.toLocaleString("ja-JP"),
    },
    {
      key: "completionTokens",
      header: "出力トークン",
      align: "right",
      render: (r) => r.completionTokens.toLocaleString("ja-JP"),
    },
    {
      key: "neurons",
      header: "Neurons",
      align: "right",
      render: (r) => r.neurons.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    },
    { key: "costJpy", header: "概算費用", align: "right", render: () => "0 円" },
    { key: "posts", header: "投稿", align: "right", render: (r) => r.posts.toLocaleString("ja-JP") },
    { key: "replies", header: "返信", align: "right", render: (r) => r.replies.toLocaleString("ja-JP") },
    { key: "replyRate", header: "応答率", align: "right", render: (r) => formatRate(r.replyRate) },
    { key: "actions", header: "アクション量", align: "right", render: (r) => r.actions.toLocaleString("ja-JP") },
    { key: "nones", header: "何もしない", align: "right", render: (r) => r.nones.toLocaleString("ja-JP") },
    {
      key: "errorRate",
      header: "エラー率",
      align: "right",
      render: (r) => {
        const isHigh = r.errorRate !== null && r.errorRate > ERROR_RATE_DANGER_THRESHOLD;
        return (
          <button
            type="button"
            onClick={() => onErrorRateClick(r.usageDate)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: isHigh ? colors.danger : colors.primary,
              fontWeight: isHigh ? 700 : 400,
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: "inherit",
            }}
          >
            {formatRate(r.errorRate)}
          </button>
        );
      },
    },
  ];

  return (
    <DataTable columns={columns} rows={items} rowKey={(r) => r.usageDate} emptyMessage="この期間のデータはありません" />
  );
}
