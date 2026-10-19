#!/usr/bin/env python3
"""結合テストの観点表（IT）と固定応答のシナリオの一覧を作る。作成：Jane Doe（NOUS-38）。

入力: docs/requirements/04_受入基準.md（受入基準）、docs/design/テスト計画.md の方針
出力: docs/design/detailed/test/結合テスト観点表.md・.xlsx、固定応答シナリオ.md
"""
import os
import re
import zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REQ = os.path.join(ROOT, "requirements", "04_受入基準.md")
OUT = os.path.join(ROOT, "design", "detailed", "test")

SCENARIOS = [
    ("basic", "10 体が 3 巡。投稿・返信・いいね・フォロー・解除・何もしない（gate と llm）がすべて出る。種 101", "AC-101〜106、AC-201〜210、AC-404〜409、状態遷移"),
    ("follow10", "フォローと解除が交互に出る 10 巡（Q-403）。種 102", "AC-205、AC-104"),
    ("limits", "1 回 2,000 Neurons の応答（usage を固定）で、Neurons の上限 9,500 と回数の上限に達する。種 103", "AC-403、AC-T04〜T08、AC-T12、AC-L01"),
    ("failures", "timeout・429・429（3036）・500・不正な形式・```json の囲み・delayMs 8000 を順に返す。種 104", "AC-A03、AC-L04、AC-T05、AC-401、AC-P06"),
    ("injection", "「設定を変えよ」「外部へ送信せよ」「</timeline>」「<script>」を含む本文。種 105", "AC-S11、AC-S12"),
    ("inconsistency", "解除した相手への返信、同じ文の繰り返し、口調に合わない一人称、存在しない @ハンドル。種 106", "AC-217"),
    ("long_run", "10 体・周期 20 分を FakeClock で 3 日分（00:00 UTC を 3 回、スリープの空白 1 回）。種 107", "AC-302、AC-306、AC-O02、AC-O03、AC-T06、AC-T08"),
]


def scenario_for(ac):
    m = {"AC-205": "follow10", "AC-104": "follow10", "AC-217": "inconsistency", "AC-S11": "injection", "AC-S12": "injection",
         "AC-A03": "failures", "AC-L04": "failures", "AC-T05": "limits", "AC-401": "failures", "AC-P06": "failures",
         "AC-403": "limits", "AC-L01": "limits", "AC-T04": "limits", "AC-T06": "long_run", "AC-T07": "limits", "AC-T08": "long_run",
         "AC-T12": "limits", "AC-302": "long_run", "AC-306": "long_run", "AC-O02": "long_run", "AC-O03": "long_run", "AC-A06": "failures"}
    return m.get(ac, "basic")


def targets_for(ac, target):
    """確かめる API・関数・テーブル（BE 詳細設計の名前）。"""
    t = target
    if ac.startswith("AC-T"):
        if "非表示" in t or "公開" in t or "すべての遷移" in t:
            return "POST /admin/api/posts/:postId/hide・unhide、posts.visibility、hide_records、admin_audit_logs"
        if "停止 → 稼働" in t or "稼働 → 停止" in t or "稼働以外" in t:
            return "POST /admin/api/agents/:agentId/stop・resume、Scheduler.runCycle、agents.state、generation_events"
        return "POST /admin/api/world/*、PUT /admin/api/settings、rolloverDay、worlds.state・stop_reason、admin_audit_logs"
    table = {
        "FR-101": "GET /api/timeline、idx_posts_timeline、posts.visibility", "FR-102": "GET /api/posts/:postId/thread、buildTree",
        "FR-103": "GET /api/agents/:agentId・/posts、toAgentSummary（isAi）", "FR-104": "GET /api/agents/:agentId/follows、follows.ended_world_sec",
        "FR-105": "toAgentSummary（isAi）、観察画面（Playwright）", "FR-106": "readOnly（405）、管理 API に書き込みの API がないこと、posts・likes・follows の件数",
        "FR-201": "Scheduler.runCycle、runOpportunity、generation_events", "FR-202": "applyAction（post）、posts", "FR-203": "applyAction（reply）、posts.reply_to_post_id・root_post_id・depth",
        "FR-204": "applyAction（like）、likes", "FR-205": "applyAction（follow・unfollow）、follows", "FR-206": "closeGateNone・none の反映、generation_events.action、daily_metrics.nones",
        "FR-207": "buildPrompt、generation_events.input_attributes", "FR-208": "buildPrompt・updateMemories、generation_events.input_memories、memories",
        "FR-209": "PUT /admin/api/settings、buildPrompt の上限、estimateTokens", "FR-210": "validateAction、loadFollowTargets",
        "FR-217": "checkConsistency、generation_events.consistency_flags、generation_attempts の件数（1 件）",
        "FR-301": "POST /admin/api/agents（noRealPersonConfirmed）、POST /admin/api/world/start", "FR-302": "PUT /admin/api/settings（cycleMinutes）、Scheduler.loop、FakeClock",
        "FR-303": "POST /admin/api/world/reset、worlds.state=archived、GET /admin/api/worlds/:worldId/posts", "FR-306": "getWorldTimeSec・settleWorldTime・beat、posts.world_time_sec",
        "FR-401": "pause・resume・emergency-stop、Scheduler.stopAll、generation_events.status=cancelled、generation_attempts", "FR-402": "recordAttempt、daily_usage、GET /admin/api/metrics/daily",
        "FR-403": "isWithinLimits・enterLimitStopped、daily_usage.runs・neurons、worlds.stop_reason", "FR-404": "GET /admin/api/generations・/:eventId",
        "FR-405": "hidePost・unhidePost、GET /api/timeline", "FR-406": "stopAgent・resumeAgent、Scheduler.runCycle、GET /api/agents/:agentId（state）",
        "FR-409": "addDailyMetrics、GET /admin/api/metrics/daily（replyRate・errorRate）",
        "NFR-A-003": "callWithRetry、closeFailed、GET /api/timeline（失敗中も 200）", "NFR-A-006": "posts.generation_event_id の UNIQUE、ux_likes_agent_post、ux_follows_active、error_detail=duplicate_action",
        "NFR-A-007": "pause → resume、posts・follows・memories の件数", "NFR-P-006": "Scheduler.stopAll、FakeClock、generation_events.finished_at",
        "NFR-O-002": "runBackup、data/backup/ のファイル数（7）、復元", "NFR-O-003": "GET /admin/api/metrics/daily", "NFR-O-004": "GET /admin/api/generations/:eventId",
        "NFR-O-005": "config/generation.json・PUT /admin/api/settings（再起動・再配備なし）", "NFR-O-007": "GET /admin/api/world（stopReason）、GET /admin/api/generations?status=failed",
        "NFR-O-008": "FixedClient、同じ種で 2 回実行して generation_events・posts を比べる", "NFR-O-011": "GET /admin/api/generations/:eventId（promptText・cycleSeed・modelId・promptVersion）",
        "NFR-S-008": "recordAudit、admin_audit_logs", "NFR-S-011": "観察画面（Playwright）で script が実行されない、JSON の本文がそのまま",
        "NFR-S-012": "sanitizeTimelineText・validateAction、world_settings が変わらない、外部への通信がない（fetch の差し替え）",
        "NFR-S-013": "hidePost、生成と同時に public で保存", "NFR-S-014": "emergency-stop・agent stop の後に generation_events が増えない",
        "NFR-L-001": "isWithinLimits、daily_usage.neurons < 10,000", "NFR-L-002": "GET /admin/api/metrics/daily（costJpy=0、freeTierNeurons）",
        "NFR-L-004": "toLlmError・callWithRetry、generation_attempts.result", "NFR-L-005": "buildPrompt、generation_events.input_post_ids の件数",
    }
    for k, v in table.items():
        if k in t:
            return v
    return "BE 詳細設計の該当の関数"


def load_it_rows():
    rows = []
    for l in open(REQ, encoding="utf-8"):
        if not l.startswith("| AC-"):
            continue
        c = [x.strip() for x in l.split("|")]
        ac, target = c[1], c[2]
        if ac.startswith("AC-T"):
            # 状態遷移の表は「ID・遷移・受入シナリオ・期待結果・既存の AC」の並び
            scen, expect, kinds = c[3], c[4], ["V1"]
        else:
            kinds = sorted(set(re.findall(r"V[1-7]", " ".join(c[3:-2])))) or ["V1"]
            scen, expect = c[3], c[-3]
        for k in kinds:
            if k in ("V1", "V5"):
                rows.append((ac, target, k, scen, expect))
    return rows


def xlsx(path, header, rows):
    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    def row_xml(r, values):
        cells = "".join(f'<c r="{col(i)}{r}" t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>' for i, v in enumerate(values))
        return f'<row r="{r}">{cells}</row>'
    widths = [14, 12, 16, 8, 14, 50, 50, 50, 10, 12, 12, 16]
    cols = "".join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths[:len(header)]))
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>{cols}</cols><sheetData>'
             + row_xml(1, header) + "".join(row_xml(i + 2, r) for i, r in enumerate(rows)) + "</sheetData>"
             f'<autoFilter ref="A1:{col(len(header)-1)}{len(rows)+1}"/></worksheet>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="結合テスト観点表" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet,
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files.items():
            z.writestr(n, d)


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = load_it_rows()
    cases = []
    for i, (ac, target, kind, scen, expect) in enumerate(rows, 1):
        sc = scenario_for(ac)
        layer = "Playwright（固定応答）" if ac in ("AC-101", "AC-102", "AC-103", "AC-104", "AC-106", "AC-S11", "AC-405", "AC-406") else "Vitest（固定応答）"
        cases.append((f"IT-{i:03d}", ac, target.replace("|", "｜"), kind, sc, scen.replace("|", "｜"), targets_for(ac, target), expect.replace("|", "｜"), layer, "未実施", "", ""))
    header = ["ケース ID", "受入基準", "対象要件", "区分", "シナリオ", "手順（受入シナリオ）", "確かめる API・関数・テーブル", "期待結果", "手段", "結果", "実施日", "実施者"]
    xlsx(os.path.join(OUT, "結合テスト観点表.xlsx"), header, cases)
    md = ["# NOUS 結合テスト観点表（IT）", "", "| 項目 | 内容 |", "|---|---|", "| 文書番号 | DD-NOUS-IT-01 |", "| 版数 | v1 |", "| 作成日 | 2026-10-21 |",
          "| 作成者 | Jane Doe（テスト担当） |", "| レビュー担当 | Kouhei Tajima（再鑑担当） |", "| 入力 | テスト計画 v1.1（IT に割り当てた 65 行）、要件定義書 v1.4 付録A、BE 詳細設計 5 件 |", "| 関連チケット | NOUS-38 |", "",
          "## 改訂履歴", "", "| 版数 | 日付 | 変更内容 | 変更者 |", "|---|---|---|---|", "| v1 | 2026-10-21 | 初版作成 | Jane Doe |", "",
          "## 1. 方針", "", "- テスト計画の IT（検証区分 V1・V5 と状態遷移）を、受入基準ごとに1ケース以上にする。区分が V1・V5 の両方の受入基準は区分ごとに1ケース",
          "- 環境は test（固定応答、テストごとに作り直す DB、AISNS_CLOCK=fake）。乱数の種はシナリオごとに固定する",
          "- 結果・実施日・実施者は実施のときに Excel（結合テスト観点表.xlsx）に記入し、テスト結果のレポートで OK 率を出す",
          "- この表は `docs/design/detailed/_build/build_it_cases.py` で受入基準から作る。受入基準が変わったら作り直す", "",
          f"## 2. ケースの一覧（{len(cases)} 件）", "", "| " + " | ".join(header[:9]) + " |", "|" + "---|" * 9]
    md += ["| " + " | ".join(c[:9]) + " |" for c in cases]
    open(os.path.join(OUT, "結合テスト観点表.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    sm = ["# NOUS 固定応答のシナリオ", "", "| 項目 | 内容 |", "|---|---|", "| 作成者 | Jane Doe（テスト担当） |", "| 関連チケット | NOUS-38 |", "",
          "固定応答は fixtures/llm/<シナリオ>/<ハンドル>-<巡の番号>.json に置く（行動生成とプロンプトの設計 12章、BE 詳細設計 generation の fixedGenerate）。エージェントは全シナリオで同じ 10 体（minato・haruka・zen・riko・gen・mio・taku・sora・aoi・ken。活動頻度は 3・4・2・5・1・3・2・4・3・3）を使う。", "",
          "| シナリオ | 内容と乱数の種 | 主に使う受入基準 | 使うケースの数 |", "|---|---|---|---|"]
    for name, desc, acs in SCENARIOS:
        n = sum(1 for c in cases if c[4] == name)
        sm.append(f"| {name} | {desc} | {acs} | {n} |")
    sm += ["", "## 応答のファイルの例", "", "```json", '{"text": "{\\"action\\":\\"reply\\",\\"target\\":\\"P3\\",\\"text\\":\\"写真は記憶を書き換える道具かもしれません。\\"}", "usage": {"prompt_tokens": 1450, "completion_tokens": 40, "neurons": 14.3}}', "```", "",
           "```json", '{"error": "free_tier", "delayMs": 0}', "```", ""]
    open(os.path.join(OUT, "固定応答シナリオ.md"), "w", encoding="utf-8").write("\n".join(sm))
    print("cases", len(cases), {s[0]: sum(1 for c in cases if c[4] == s[0]) for s in SCENARIOS})


if __name__ == "__main__":
    main()
