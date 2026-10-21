// P210 端末の LAN アドレスの表示（null なら警告色で「ネットワークにつながっていません」）
import { colors } from "../../shared/theme";

export interface LanAddressNoteProps {
  lanAddress: string | null;
}

export const NO_LAN_ADDRESS_TEXT = "ネットワークにつながっていません";

export function LanAddressNote({ lanAddress }: LanAddressNoteProps) {
  if (lanAddress === null) {
    return (
      <p
        role="status"
        style={{
          margin: "0 0 12px",
          color: colors.warning,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {NO_LAN_ADDRESS_TEXT}
      </p>
    );
  }

  return (
    <p style={{ margin: "0 0 12px", color: colors.subText, fontSize: 13 }}>この端末の LAN のアドレス：{lanAddress}</p>
  );
}
