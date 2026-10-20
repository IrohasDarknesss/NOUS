import type { AgentProfileView } from "../../api/types";
import { colors } from "../../lib/theme";

interface Props {
  agent: AgentProfileView;
}

const ATTRIBUTE_ROWS: ReadonlyArray<{ label: string; getValue: (agent: AgentProfileView) => string }> = [
  { label: "興味", getValue: (a) => a.interests },
  { label: "関心分野", getValue: (a) => a.topics },
  { label: "性格", getValue: (a) => a.personality },
  { label: "価値観", getValue: (a) => a.valuesText },
  { label: "主張傾向", getValue: (a) => a.stance },
];

/** 人格の項目の表（興味・関心分野・性格・価値観・主張傾向。P103 H12〜H16） */
export function AttributeTable({ agent }: Props) {
  return (
    <section
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {ATTRIBUTE_ROWS.map((row) => (
            <tr key={row.label} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th
                scope="row"
                style={{
                  textAlign: "left",
                  color: colors.muted,
                  fontWeight: 600,
                  padding: "8px 12px 8px 0",
                  width: 96,
                  verticalAlign: "top",
                }}
              >
                {row.label}
              </th>
              <td
                style={{
                  color: colors.text,
                  padding: "8px 0",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {row.getValue(agent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
