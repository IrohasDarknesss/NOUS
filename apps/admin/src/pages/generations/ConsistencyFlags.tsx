// P208 生成ログ詳細：記憶との矛盾の候補（C01〜C04 の日本語）（FE 詳細設計 admin_agents_logs 2章・4章、画面基本設計書 P208 4章）
import type { ConsistencyCode, ConsistencyFlag } from "@nous/shared";
import { colors } from "../../shared/theme";

export const CONSISTENCY_FLAG_LABELS: Record<ConsistencyCode, string> = {
  C01: "解除した相手への 3 巡以内の返信",
  C02: "過去の発言の繰り返し",
  C03: "口調に合わない一人称",
  C04: "存在しない住人への言及",
};

/** 矛盾の候補のコードを日本語の説明に変える */
export function describeFlag(flag: ConsistencyFlag | ConsistencyCode): string {
  const code = typeof flag === "string" ? flag : flag.code;
  return CONSISTENCY_FLAG_LABELS[code] ?? code;
}

export interface ConsistencyFlagsProps {
  flags: readonly ConsistencyFlag[] | null;
}

export function ConsistencyFlags({ flags }: ConsistencyFlagsProps) {
  return (
    <section
      aria-label="記憶との矛盾の候補"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>記憶との矛盾の候補</h2>
      {!flags || flags.length === 0 ? (
        <p style={{ margin: 0, color: colors.subText }}>なし</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {flags.map((f, idx) => (
            <li key={`${f.code}-${idx}`} style={{ marginBottom: 4 }}>
              <strong>
                {f.code}：{describeFlag(f)}
              </strong>
              {f.detail && <span style={{ marginLeft: 8, color: colors.subText }}>（{f.detail}）</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
