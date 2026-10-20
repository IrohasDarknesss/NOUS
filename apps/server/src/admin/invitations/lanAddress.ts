// 端末の私設 IPv4 アドレスの取得（BE 詳細設計 admin_auth 2章・4章 getLanAddress）
import os from "node:os";

export interface LanInterfaceInfo {
  address: string;
  family: "IPv4" | "IPv6" | string | number;
  internal: boolean;
}

export type NetworkInterfaces = NodeJS.Dict<readonly LanInterfaceInfo[]>;

type Ipv4Octets = [number, number, number, number];

function parseIpv4(address: string): Ipv4Octets | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

const isPrivate192 = ([a, b]: Ipv4Octets): boolean => a === 192 && b === 168;
const isPrivate10 = ([a]: Ipv4Octets): boolean => a === 10;
const isPrivate172 = ([a, b]: Ipv4Octets): boolean => a === 172 && b >= 16 && b <= 31;

/**
 * os.networkInterfaces() の IPv4 で internal でないものを集め、
 * 192.168/16 → 10/8 → 172.16/12 の順で最初のものを返す。無ければ null
 */
export function getLanAddress(interfaces: NetworkInterfaces = os.networkInterfaces()): string | null {
  const candidates: Array<{ address: string; octets: Ipv4Octets }> = [];
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const info of list) {
      if ((info.family === "IPv4" || info.family === 4) && !info.internal) {
        const octets = parseIpv4(info.address);
        if (octets) {
          candidates.push({ address: info.address, octets });
        }
      }
    }
  }

  for (const predicate of [isPrivate192, isPrivate10, isPrivate172]) {
    const found = candidates.find((c) => predicate(c.octets));
    if (found) return found.address;
  }
  return null;
}
