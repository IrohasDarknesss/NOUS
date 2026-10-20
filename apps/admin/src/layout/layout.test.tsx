import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatStopReason, WorldStateBadge } from "./WorldStateBadge";
import { formatWorldTime } from "./worldTime";

describe("レイアウトの表示", () => {
  it("TC-NOUS50_DEV-18 世界内時間を「第 N 日 HH:MM」にする", () => {
    expect(formatWorldTime(0)).toBe("第 1 日 00:00");
    expect(formatWorldTime(86_399)).toBe("第 1 日 23:59");
    expect(formatWorldTime(86_400)).toBe("第 2 日 00:00");
    expect(formatWorldTime(7260)).toBe("第 1 日 02:01");
  });

  it("TC-NOUS50_DEV-19 停止理由を日本語にする", () => {
    expect(formatStopReason("neurons_limit")).toBe("Neurons の上限");
    expect(formatStopReason("runs_limit")).toBe("生成の回数の上限");
    expect(formatStopReason("free_tier_error")).toBe("無料枠の上限（Cloudflare）");
    expect(formatStopReason("manual_pause")).toBe("一時停止");
    expect(formatStopReason("emergency")).toBe("緊急停止");
    expect(formatStopReason(null)).toBe("");
  });

  it("TC-NOUS50_DEV-20 WorldStateBadge は状態の色と、上限停止のときは理由を出す", () => {
    render(<WorldStateBadge state="limit_stopped" stopReason="runs_limit" />);
    const badge = screen.getByText("上限停止（生成の回数の上限）");
    expect(badge).toHaveStyle({ background: "#EA580C" });
  });
});
