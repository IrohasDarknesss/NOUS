// 表（P202・P203・P207・P209〜P211 が使う）
import type { ReactNode } from "react";
import { colors, fontSizes } from "./theme";

export interface DataTableColumn<R> {
  key: string;
  header: string;
  render: (row: R) => ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<R> {
  columns: readonly DataTableColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  onRowClick?: (row: R) => void;
  emptyMessage: string;
}

export function DataTable<R>({ columns, rows, rowKey, onRowClick, emptyMessage }: DataTableProps<R>) {
  const cell = { padding: "8px 10px", borderBottom: `1px solid ${colors.border}` } as const;
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        background: colors.surface,
        fontSize: fontSizes.table,
      }}
    >
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={{ ...cell, textAlign: c.align ?? "left", width: c.width, background: "#E2E8F0", fontWeight: 600 }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} style={{ ...cell, textAlign: "center", color: colors.subText }}>
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : undefined }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ ...cell, textAlign: c.align ?? "left" }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
