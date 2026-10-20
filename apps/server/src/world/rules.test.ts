import { describe, expect, it } from "vitest";
import { WORLD_STATES } from "../db/schema";
import { isWithinLimits, limitReason } from "./limits";
import { canTransition, type WorldState } from "./stateMachine";
import { getWorldTimeSec, heartbeatPatch, startupPatch } from "./worldTime";

const LIMITS = { daily_neurons_limit: 9500, daily_runs_limit: 480 };

describe("canTransition", () => {
  const allowed: Array<[WorldState, WorldState]> = [
    ["preparing", "running"],
    ["running", "paused"],
    ["paused", "running"],
    ["paused", "limit_stopped"],
    ["limit_stopped", "paused"],
    ["running", "limit_stopped"],
    ["limit_stopped", "running"],
    ["running", "emergency_stopped"],
    ["paused", "emergency_stopped"],
    ["limit_stopped", "emergency_stopped"],
    ["emergency_stopped", "running"],
    ["emergency_stopped", "limit_stopped"],
    ["paused", "archived"],
    ["limit_stopped", "archived"],
    ["emergency_stopped", "archived"],
  ];

  it("TC-NOUS57_DEV-01 遷移の表にある組はすべて許可する", () => {
    for (const [from, to] of allowed) expect(canTransition(from, to), `${from}→${to}`).toBe(true);
  });

  it("TC-NOUS57_DEV-02 遷移の表にない組はすべて拒否する", () => {
    for (const from of WORLD_STATES) {
      for (const to of WORLD_STATES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from}→${to}`).toBe(expected);
      }
    }
  });

  it("TC-NOUS57_DEV-03 preparing と running からは archived にできない（リセット不可）", () => {
    expect(canTransition("preparing", "archived")).toBe(false);
    expect(canTransition("running", "archived")).toBe(false);
  });

  it("TC-NOUS57_DEV-04 archived からはどこへも遷移しない", () => {
    for (const to of WORLD_STATES) expect(canTransition("archived", to)).toBe(false);
  });
});

describe("isWithinLimits・limitReason", () => {
  it("TC-NOUS57_DEV-05 両方とも上限未満なら上限の中", () => {
    expect(isWithinLimits({ neurons: 9499.9, runs: 479 }, LIMITS)).toBe(true);
    expect(limitReason({ neurons: 9499.9, runs: 479 }, LIMITS)).toBeNull();
  });

  it("TC-NOUS57_DEV-06 Neurons が 9,500 以上なら neurons_limit", () => {
    expect(isWithinLimits({ neurons: 9500, runs: 0 }, LIMITS)).toBe(false);
    expect(limitReason({ neurons: 9500, runs: 0 }, LIMITS)).toBe("neurons_limit");
  });

  it("TC-NOUS57_DEV-07 実行回数が 480 以上なら runs_limit", () => {
    expect(isWithinLimits({ neurons: 0, runs: 480 }, LIMITS)).toBe(false);
    expect(limitReason({ neurons: 0, runs: 480 }, LIMITS)).toBe("runs_limit");
  });

  it("TC-NOUS57_DEV-08 両方とも上限なら neurons_limit を先に返す", () => {
    expect(limitReason({ neurons: 10000, runs: 500 }, LIMITS)).toBe("neurons_limit");
  });
});

describe("世界内時間", () => {
  const base = { world_elapsed_sec: 100, heartbeat_at: null };

  it("TC-NOUS57_DEV-09 running なら確定分に running_since からの秒（切り捨て）を足す", () => {
    const world = { ...base, state: "running", running_since: "2026-10-22T00:00:00.000Z" };
    expect(getWorldTimeSec(world, new Date("2026-10-22T00:01:00.999Z"))).toBe(160);
  });

  it("TC-NOUS57_DEV-10 running 以外は確定分だけ", () => {
    const world = { ...base, state: "paused", running_since: null };
    expect(getWorldTimeSec(world, new Date("2026-10-22T05:00:00.000Z"))).toBe(100);
  });

  it("TC-NOUS57_DEV-11 生存時刻が 180 秒を超えて古ければ、最後の生存時刻までを足して running_since を now にする", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 100,
      running_since: "2026-10-22T00:00:00.000Z",
      heartbeat_at: "2026-10-22T00:10:00.000Z",
    };
    const now = new Date("2026-10-22T02:00:00.000Z");
    expect(heartbeatPatch(world, now)).toEqual({
      world_elapsed_sec: 700,
      running_since: now.toISOString(),
      heartbeat_at: now.toISOString(),
    });
    // 補正の後の世界内時間は、止まっていた 1 時間 50 分を数えない
    expect(getWorldTimeSec({ ...world, ...heartbeatPatch(world, now)! }, now)).toBe(700);
  });

  it("TC-NOUS57_DEV-12 生存時刻が 180 秒以内なら heartbeat_at だけを更新する", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 100,
      running_since: "2026-10-22T00:00:00.000Z",
      heartbeat_at: "2026-10-22T00:10:00.000Z",
    };
    const now = new Date("2026-10-22T00:13:00.000Z");
    expect(heartbeatPatch(world, now)).toEqual({
      world_elapsed_sec: 100,
      running_since: "2026-10-22T00:00:00.000Z",
      heartbeat_at: now.toISOString(),
    });
  });

  it("TC-NOUS57_DEV-13 起動時の補正は、最後の生存時刻までを足して running_since と heartbeat_at を now にする", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 0,
      running_since: "2026-10-22T00:00:00.000Z",
      heartbeat_at: "2026-10-22T00:00:30.000Z",
    };
    const now = new Date("2026-10-23T00:00:00.000Z");
    expect(startupPatch(world, now)).toEqual({
      world_elapsed_sec: 30,
      running_since: now.toISOString(),
      heartbeat_at: now.toISOString(),
    });
  });

  it("TC-NOUS57_DEV-14 running でなければ補正しない", () => {
    const world = { state: "paused", world_elapsed_sec: 5, running_since: null, heartbeat_at: null };
    expect(heartbeatPatch(world, new Date())).toBeNull();
    expect(startupPatch(world, new Date())).toBeNull();
  });
});
