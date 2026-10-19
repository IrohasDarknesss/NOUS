#!/usr/bin/env python3
"""画面基本設計書（structure 02）を、仕様のデータ（specs_*.py）から生成する。

使い方: python3 docs/design/screens/_build/gen_screens.py
出力: docs/design/screens/P*.md と docs/design/screens/design/P*_Wireframe_{mobile,desktop}.svg
"""
import html
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

ERROR_STYLES = [
    ("様式①", "ポップアップ表示", "モーダルダイアログで画面中央にエラーメッセージを表示", "ErrorModal"),
    ("様式②", "画面上部表示", "画面上部（ヘッダー直下）に赤色バーでメッセージを表示", "ErrorBanner"),
    ("様式③", "全画面エラー", "専用のエラー表示に画面全体を切り替えて表示", "ErrorPage"),
    ("様式④", "入力欄下表示", "対象の入力フィールド直下に赤文字でインラインエラーを表示", "FieldError"),
]


def esc(s):
    return html.escape(str(s), quote=True)


def svg(screen, mode):
    """ブロックの並びから、ワイヤーフレームの SVG を作る。"""
    blocks = screen["wire"][mode]
    if mode == "mobile":
        W, x0, w = 414, 16, 382
        side = None
    else:
        W = 1440
        side = screen.get("sidebar")
        x0, w = (260, 1140) if side else (400, 640)
    y = 16
    parts = []
    for label, h, kind in blocks:
        fill = {"header": "#E2E8F0", "band": "#EDE9FE", "card": "#FFFFFF", "button": "#DBEAFE",
                "danger": "#FEE2E2", "input": "#FFFFFF", "table": "#FFFFFF", "footer": "#F1F5F9",
                "note": "#FEF9C3", "tabs": "#F1F5F9"}.get(kind, "#FFFFFF")
        dash = ' stroke-dasharray="4 3"' if kind == "input" else ""
        parts.append(f'<rect x="{x0}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="#64748B"{dash}/>')
        lines = label.split("\n")
        for i, ln in enumerate(lines):
            parts.append(f'<text x="{x0 + 12}" y="{y + 20 + i * 16}" fill="#0F172A">{esc(ln)}</text>')
        y += h + 10
    H = y + 6
    if side:
        parts.insert(0, f'<rect x="0" y="0" width="240" height="{H}" fill="#1E293B"/>')
        for i, item in enumerate(side):
            parts.insert(1, f'<text x="20" y="{90 + i * 32}" fill="#F8FAFC">{esc(item)}</text>')
        parts.insert(1, '<text x="20" y="40" fill="#F8FAFC" font-size="14">NOUS 管理</text>')
    label = "モバイル" if mode == "mobile" else "デスクトップ"
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="Noto Sans JP, sans-serif" font-size="12" role="img" '
            f'aria-label="{esc(screen["name"])} ワイヤーフレーム（{label}）">')
    return head + f'<rect x="0" y="0" width="{W}" height="{H}" fill="#F8FAFC"/>' + "".join(parts) + "</svg>\n"


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join([":---"] * len(header)) + " |"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def md(s):
    pid, slug = s["id"], s["slug"]
    L = [f"# {pid} {s['name']}", "",
         "| 項目 | 内容 |", "| :--- | :--- |"]
    L += [f"| 文書番号 | BD-NOUS-SC-{pid} |", f"| 版数 | {s.get('version', 'v1')} |",
          f"| 作成者 | {s['author']} |", "| レビュー担当 | Kouhei Tajima（再鑑担当） |",
          f"| 関連チケット | {s['ticket']} |", ""]
    L += ["## 1. 画面概要", "", table(["項目", "内容"], [
        ("画面ID", pid), ("画面名", s["name"]), ("パス", s["path"]), ("概要", s["summary"]),
        ("アクター", s["actor"]), ("認証要否", s["auth"]), ("前画面", s["prev"]), ("後画面", s["next"]),
        ("対応ソースファイル", s["src"]), ("カラーテーマ", s["theme"]),
        ("対応する要件", s["reqs"])]), ""]
    L += ["## 2. ワイヤーフレーム", ""]
    L += ["### 2.1 ワイヤーフレーム（モバイル）", ""]
    if "mobile" in s["wire"]:
        L += [f"![{s['name']} Wireframe (Mobile)](design/{pid}_{slug}_Wireframe_mobile.svg)", ""]
    else:
        L += [f"該当なし。{s.get('no_mobile_reason', '')}", ""]
    L += ["### 2.2 ワイヤーフレーム（デスクトップ）（該当する場合のみ）", "",
          f"![{s['name']} Wireframe (Desktop)](design/{pid}_{slug}_Wireframe_desktop.svg)", ""]
    L += ["### 2.3 画面レイアウト説明", "", s["layout"], ""]
    L += ["## 3. UI構成・コンポーネント定義", "", "### 3.1 コンポーネントツリー", "", "```mermaid", "graph TD"]
    for c in s["components"]:
        L.append(f'    {c[0]}["{c[1]}"]')
    for c in s["components"]:
        if c[6]:
            L.append(f"    {c[6]} --> {c[0]}")
    L += ["```", "", "### 3.2 コンポーネント一覧", "",
          table(["コンポーネントID", "コンポーネント名", "種別", "Props", "内部State", "役割・概要"],
                [c[:6] for c in s["components"]]), ""]
    L += ["## 4. 画面項目定義", "",
          table(["項目ID", "項目名", "種別", "必須", "データ型", "制約・初期値", "表示条件", "備考"], s["items"]), ""]
    if s.get("items_reason"):
        L += [f"項目数がノルマ（15 項目）に満たない理由：{s['items_reason']}。", ""]
    L += ["## 5. イベント定義", "",
          table(["イベントID", "発生源", "トリガー", "条件", "処理概要", "呼び出しAPI", "成功時の挙動",
                 "失敗時の挙動（様式ID + 説明）"], s["events"]), ""]
    used = s["errors"]
    rows = []
    for sid, name, how, comp in ERROR_STYLES:
        if sid in used:
            rows.append((sid, name, how, comp, used[sid][0], used[sid][1]))
        else:
            rows.append((sid, name, "該当なし", "該当なし", "該当なし", "該当なし"))
    L += ["### 5.1 エラー表示様式定義", "",
          table(["様式ID", "様式名", "表示方法", "使用コンポーネント", "使用場面", "ユーザー操作"], rows), "",
          "**この画面で使用するエラー様式の詳細**:", "",
          table(["様式ID", "エラー発生条件", "エラーメッセージ文言", "補足（遷移先・復帰手順）"], s["error_details"]), ""]
    L += ["## 6. バリデーション・制約定義", ""]
    if s.get("validations"):
        L += [table(["対象項目ID", "項目名", "ルール", "エラーメッセージ"], s["validations"]), ""]
    else:
        L += ["該当なし。" + s.get("no_validation_reason", "この画面に入力項目はない。"), ""]
    L += ["## 7. 画面固有の業務ルール・注意事項", ""]
    L += [f"* {r}" for r in s["rules"]]
    L.append("")
    return "\n".join(L)


def main():
    import specs_observer
    import specs_admin
    screens = specs_observer.SCREENS + specs_admin.SCREENS
    for s in screens:
        assert len(s["items"]) >= 15 or s.get("items_reason"), (s["id"], "items")
        assert len(s["events"]) >= 5, (s["id"], "events")
        assert len(s["components"]) >= 5, (s["id"], "components")
        open(os.path.join(OUT, f"{s['id']}_{s['slug']}.md"), "w", encoding="utf-8").write(md(s))
        for mode in s["wire"]:
            open(os.path.join(OUT, "design", f"{s['id']}_{s['slug']}_Wireframe_{mode}.svg"), "w",
                 encoding="utf-8").write(svg(s, mode))
        print(f"{s['id']} items={len(s['items'])} events={len(s['events'])} components={len(s['components'])}")


if __name__ == "__main__":
    main()
