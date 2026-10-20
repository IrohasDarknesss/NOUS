import { describe, expect, it } from "vitest";
import { getLanAddress, type NetworkInterfaces } from "./lanAddress";

describe("lanAddress", () => {
  it("TC-NOUS54_DEV-01 192.168/16 → 10/8 → 172.16/12 の優先順位で最初の非 internal な IPv4 アドレスを返す", () => {
    const interfaces: NetworkInterfaces = {
      en0: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "172.16.0.5", family: "IPv4", internal: false },
        { address: "10.0.0.8", family: "IPv4", internal: false },
      ],
      en1: [
        { address: "192.168.1.10", family: "IPv4", internal: false },
        { address: "192.168.1.20", family: "IPv4", internal: false },
      ],
    };
    expect(getLanAddress(interfaces)).toBe("192.168.1.10");
  });

  it("TC-NOUS54_DEV-02 192.168/16 が無く 10/8 と 172.16/12 がある場合は 10/8 を返す", () => {
    const interfaces: NetworkInterfaces = {
      eth0: [
        { address: "172.20.1.2", family: "IPv4", internal: false },
        { address: "10.1.2.3", family: "IPv4", internal: false },
      ],
    };
    expect(getLanAddress(interfaces)).toBe("10.1.2.3");
  });

  it("TC-NOUS54_DEV-03 172.16.0.0〜172.31.255.255 の範囲内だけを返し、172.15.* や 172.32.* は除外する", () => {
    const outOfRange: NetworkInterfaces = {
      eth0: [
        { address: "172.15.255.1", family: "IPv4", internal: false },
        { address: "172.32.0.1", family: "IPv4", internal: false },
      ],
    };
    expect(getLanAddress(outOfRange)).toBeNull();

    const inRange: NetworkInterfaces = {
      eth0: [
        { address: "172.15.255.1", family: "IPv4", internal: false },
        { address: "172.31.255.254", family: "IPv4", internal: false },
      ],
    };
    expect(getLanAddress(inRange)).toBe("172.31.255.254");
  });

  it("TC-NOUS54_DEV-04 internal: true・IPv6・私設範囲外のアドレスしか無い場合や空の場合は null を返す", () => {
    const interfaces: NetworkInterfaces = {
      lo0: [
        { address: "192.168.1.1", family: "IPv4", internal: true },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      en0: [
        { address: "169.254.10.20", family: "IPv4", internal: false },
        { address: "8.8.8.8", family: "IPv4", internal: false },
      ],
    };
    expect(getLanAddress(interfaces)).toBeNull();
    expect(getLanAddress({})).toBeNull();
  });
});
