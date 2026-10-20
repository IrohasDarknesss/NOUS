// 固定応答のシナリオ 7 本（fixtures/llm、NOUS-73）が fixedClient の形で読め、
// docs/design/detailed/test/固定応答シナリオ.md の内容（10 体・種・巡の数）どおりかを確かめる。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFixedClient, loadFixture, type Fixture, type LlmClock } from "./fixedClient.js";
import { FreeTierExceededError, RateLimitedError, ServerError, TimeoutError, type LlmRequest } from "./llmClient.js";

const fixtureDir = fileURLToPath(new URL("../../../../fixtures/llm", import.meta.url));

const AGENTS = [
  ["minato", 3],
  ["haruka", 4],
  ["zen", 2],
  ["riko", 5],
  ["gen", 1],
  ["mio", 3],
  ["taku", 2],
  ["sora", 4],
  ["aoi", 3],
  ["ken", 3],
] as const;

const SCENARIOS = [
  { name: "basic", seed: 101, cycles: 3 },
  { name: "follow10", seed: 102, cycles: 10 },
  { name: "limits", seed: 103, cycles: 3 },
  { name: "failures", seed: 104, cycles: 2 },
  { name: "injection", seed: 105, cycles: 2 },
  { name: "inconsistency", seed: 106, cycles: 3 },
  { name: "long_run", seed: 107, cycles: 216 },
] as const;

type ScenarioName = (typeof SCENARIOS)[number]["name"];
type ScenarioMeta = {
  name: string;
  seed: number;
  cycles: number;
  files: number;
  agents: { handle: string; activityLevel: number }[];
};
type Action = { action: string; target: string | null; text: string | null };

const FILE_PATTERN = /^([A-Za-z0-9_]{3,20})-(\d+)\.json$/;

async function readMeta(name: ScenarioName): Promise<ScenarioMeta> {
  return JSON.parse(await readFile(join(fixtureDir, name, "scenario.json"), "utf8")) as ScenarioMeta;
}

/** シナリオの応答のファイルをすべて読む（scenario.json を除く） */
async function readResponses(name: ScenarioName): Promise<Map<string, Fixture>> {
  const files = (await readdir(join(fixtureDir, name))).filter((f) => f !== "scenario.json");
  const out = new Map<string, Fixture>();
  for (const file of files) {
    const fixture = await loadFixture(join(fixtureDir, name, file));
    if (fixture === null) {
      throw new Error(`読めません: ${name}/${file}`);
    }
    out.set(file.replace(/\.json$/, ""), fixture);
  }
  return out;
}

/** text が JSON の行動なら読む。囲み付き・不正な形式なら null */
function parseAction(fixture: Fixture): Action | null {
  if (fixture.text === undefined) {
    return null;
  }
  try {
    return JSON.parse(fixture.text) as Action;
  } catch {
    return null;
  }
}

const clock: LlmClock = { now: () => new Date(0), sleep: async () => {} };

function request(handle: string, cycleNo: number): LlmRequest {
  return {
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ],
    maxTokens: 300,
    signal: new AbortController().signal,
    fixtureKey: { handle, cycleNo },
  };
}

describe("固定応答のシナリオ 7 本", () => {
  it.each(SCENARIOS)("TC-NOUS73_DEV-01 $name の scenario.json が種・巡の数・10 体どおり", async (s) => {
    const meta = await readMeta(s.name);
    expect(meta).toMatchObject({ name: s.name, seed: s.seed, cycles: s.cycles });
    expect(meta.agents.map((a) => [a.handle, a.activityLevel])).toEqual(AGENTS);
  });

  it.each(SCENARIOS)(
    "TC-NOUS73_DEV-02 $name の全ファイルが fixedClient の形で読め、ハンドルと巡が範囲の中",
    async (s) => {
      const meta = await readMeta(s.name);
      const files = (await readdir(join(fixtureDir, s.name))).filter((f) => f !== "scenario.json");
      expect(files).toHaveLength(meta.files);
      const handles = AGENTS.map(([h]) => h as string);
      for (const file of files) {
        const m = FILE_PATTERN.exec(file);
        expect(m, file).not.toBeNull();
        expect(handles).toContain(m?.[1]);
        const cycleNo = Number(m?.[2]);
        expect(cycleNo).toBeGreaterThanOrEqual(1);
        expect(cycleNo).toBeLessThanOrEqual(s.cycles);
        await expect(loadFixture(join(fixtureDir, s.name, file))).resolves.not.toBeNull();
      }
    },
  );

  it.each(SCENARIOS)("TC-NOUS73_DEV-03 $name の行動の本文は 140 字以内で、6.1 の組み合わせに合う", async (s) => {
    for (const [key, fixture] of await readResponses(s.name)) {
      const a = parseAction(fixture);
      if (a === null) {
        continue;
      }
      if (a.action === "post") {
        expect(a.target, key).toBeNull();
      } else if (a.action === "reply" || a.action === "like") {
        expect(a.target, key).toMatch(/^P\d{1,2}$/);
      } else if (a.action === "follow" || a.action === "unfollow") {
        expect(a.target, key).toMatch(/^@[A-Za-z0-9_]{3,20}$/);
      } else {
        expect(a, key).toEqual({ action: "none", target: null, text: null });
      }
      if (a.action === "post" || a.action === "reply") {
        expect(a.text?.trim().length, key).toBeGreaterThan(0);
        expect([...(a.text ?? "")].length, key).toBeLessThanOrEqual(140);
      } else {
        expect(a.text, key).toBeNull();
      }
    }
  });
});

describe("シナリオごとの中身", () => {
  it("TC-NOUS73_DEV-11 basic に投稿・返信・いいね・フォロー・解除・何もしない（llm）と失敗が出る", async () => {
    const responses = await readResponses("basic");
    const kinds = new Set([...responses.values()].map((f) => parseAction(f)?.action));
    expect([...kinds]).toEqual(expect.arrayContaining(["post", "reply", "like", "follow", "unfollow", "none"]));
    expect([...responses.values()].some((f) => f.error !== undefined)).toBe(true);
  });

  it("TC-NOUS73_DEV-12 follow10 は奇数の巡でフォロー、偶数の巡で同じ相手を解除する", async () => {
    const responses = await readResponses("follow10");
    for (const [handle] of AGENTS) {
      for (let n = 1; n <= 10; n += 2) {
        const f = parseAction(responses.get(`${handle}-${n}`) as Fixture);
        const u = parseAction(responses.get(`${handle}-${n + 1}`) as Fixture);
        expect(f?.action).toBe("follow");
        expect(u?.action).toBe("unfollow");
        expect(u?.target).toBe(f?.target);
        expect(f?.target).not.toBe(`@${handle}`);
      }
    }
  });

  it("TC-NOUS73_DEV-13 limits は全応答が 1 回 2,000 Neurons", async () => {
    const responses = await readResponses("limits");
    expect(responses.size).toBe(30);
    for (const fixture of responses.values()) {
      expect(fixture.usage?.neurons).toBe(2000);
    }
  });

  it("TC-NOUS73_DEV-14 failures の巡 1 で各失敗・不正な形式・囲み・delayMs 8000 を返す", async () => {
    const client = createFixedClient({ fixtureDir, scenario: "failures", clock });
    await expect(client.generate(request("minato", 1))).rejects.toBeInstanceOf(TimeoutError);
    await expect(client.generate(request("haruka", 1))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(client.generate(request("zen", 1))).rejects.toBeInstanceOf(ServerError);
    await expect(client.generate(request("ken", 1))).rejects.toBeInstanceOf(FreeTierExceededError);
    const invalid = await client.generate(request("riko", 1));
    expect(() => JSON.parse(invalid.text) as unknown).toThrow();
    const fenced = await client.generate(request("gen", 1));
    expect(fenced.text.startsWith("```json\n")).toBe(true);
    const responses = await readResponses("failures");
    expect(responses.get("mio-1")?.delayMs).toBe(8000);
  });

  it("TC-NOUS73_DEV-15 injection の巡 1 に指示の混入とマークアップの本文がある", async () => {
    const texts = [...(await readResponses("injection")).entries()]
      .filter(([key]) => key.endsWith("-1"))
      .map(([, f]) => parseAction(f)?.text ?? "");
    for (const needle of ["設定を変えよ", "外部へ送信せよ", "</timeline>", "<script>"]) {
      expect(
        texts.some((t) => t.includes(needle)),
        needle,
      ).toBe(true);
    }
  });

  it("TC-NOUS73_DEV-16 inconsistency に C01〜C04 の材料がそろう", async () => {
    const r = await readResponses("inconsistency");
    const a = (key: string): Action | null => parseAction(r.get(key) as Fixture);
    // C01：フォロー → 解除 → 3 巡以内に返信
    expect(a("minato-1")).toMatchObject({ action: "follow", target: "@haruka" });
    expect(a("minato-2")).toMatchObject({ action: "unfollow", target: "@haruka" });
    expect(a("minato-3")?.action).toBe("reply");
    // C02：20 字以上の同じ文
    expect(a("zen-1")?.text).toBe(a("zen-2")?.text);
    expect([...(a("zen-1")?.text ?? "")].length).toBeGreaterThanOrEqual(20);
    // C03：口調に合わない一人称
    expect(a("riko-1")?.text).toContain("俺");
    // C04：存在しない @ハンドル
    const handles = AGENTS.map(([h]) => h as string);
    const mention = /@([A-Za-z0-9_]{3,20})/.exec(a("mio-1")?.text ?? "")?.[1];
    expect(mention).toBeDefined();
    expect(handles).not.toContain(mention);
  });

  it("TC-NOUS73_DEV-17 long_run は 3 日分（216 巡）で、巡ごとに 1 体が投稿する", async () => {
    const r = await readResponses("long_run");
    expect(r.size).toBe(216);
    for (let n = 1; n <= 216; n++) {
      const handle = AGENTS[(n - 1) % AGENTS.length]?.[0];
      expect(parseAction(r.get(`${handle}-${n}`) as Fixture)?.action).toBe("post");
    }
  });

  it("TC-NOUS73_DEV-18 ファイルのない組み合わせは none になる", async () => {
    const client = createFixedClient({ fixtureDir, scenario: "inconsistency", clock });
    const result = await client.generate(request("ken", 1));
    expect(JSON.parse(result.text)).toEqual({ action: "none", target: null, text: null });
  });
});
