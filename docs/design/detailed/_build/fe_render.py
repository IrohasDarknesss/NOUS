#!/usr/bin/env python3
"""FE 詳細設計書（structure 04-1）を、領域ごとの仕様（fe_spec_*.py）から生成する。

使い方: python3 docs/design/detailed/_build/fe_render.py
出力: docs/design/detailed/front/<name>.md
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "front")
sys.path.insert(0, HERE)
SPECS = ["fe_spec_observer", "fe_spec_admin_control", "fe_spec_admin_agents_logs", "fe_spec_admin_moderation"]


def table(h, rows):
    return "\n".join(["| " + " | ".join(h) + " |", "| " + " | ".join([":---"] * len(h)) + " |"] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows])


def render(s):
    L = [f"# NOUS フロントエンド詳細設計書：{s['title']}（{s['name']}）", "",
         "| 項目 | 内容 |", "|---|---|", f"| 文書番号 | DD-NOUS-FE-{s['name'].upper()} |", f"| 版数 | {s.get('version', 'v1')} |",
         "| 作成日 | 2026-10-21 |", f"| 作成者 | {s['author']} |", "| レビュー担当 | Kouhei Tajima（再鑑担当） |",
         f"| 入力 | {s['inputs']} |", f"| 関連チケット | {s['ticket']} |", "", "## 改訂履歴", "",
         "| 版数 | 日付 | 変更内容 | 変更者 |", "|---|---|---|---|"] + [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in s["history"]] + ["", "---", ""]
    L += ["## 1. フロントエンド構成・ルーティング設計", "", f"* **対象ドメイン**: {s['domain']}", f"* **対象画面ID**: {s['screens']}",
          "* **ディレクトリ/ファイル構造**:", "", "```", s["tree"].strip("\n"), "```", "", "* **ルーティング定義**:", "",
          table(["パス", "コンポーネント", "認証要否", "ルートファイル"], s["routes"]), ""]
    L += ["## 2. コンポーネント設計", "", "* **コンポーネントツリー図**:", "", "```mermaid", "graph TD"]
    for c in s["components"]:
        L.append(f'    {c[0]}["{c[0]}"]')
    for c in s["components"]:
        if c[6]:
            L.append(f"    {c[6]} --> {c[0]}")
    L += ["```", "", "* **コンポーネント詳細定義**:", "",
          table(["コンポーネント名", "種類(Page/UI/HOC等)", "ファイルパス", "Props (型)", "内部State (型)", "役割・概要"], [c[:6] for c in s["components"]]), ""]
    L += ["## 3. 状態管理（State）設計", "", "* **グローバルステート / Context定義**:", "",
          table(["State名", "型", "スコープ", "初期値", "更新タイミング", "管理方法"], s["global_state"]), "", "* **ローカルステート定義**:", "",
          table(["コンポーネント", "State名", "型", "初期値", "用途"], s["local_state"]), "", "* **永続化ステート**:", "",
          table(["キー", "保存先", "型", "用途", "有効期限"], s["persist"]), ""]
    L += ["## 4. クライアント側機能・処理ロジック設計（IPO設計）", "", "* **処理フロー図**:", "", "```mermaid", s["flow"].strip("\n"), "```", "",
          "* **入力・処理・出力（IPO）定義**:", "",
          table(["関数名", "所属コンポーネント", "引数 (型)", "処理フロー (ステップ単位で具体的に)", "戻り値", "発生しうるエラー"], s["ipo"]), ""]
    L += ["## 5. イベントハンドラ・アクション定義", "", "* **ユーザーアクションマッピング**:", "",
          table(["画面ID", "要素", "トリガー", "発火関数名", "処理の概要", "遷移先"], s["actions"]), ""]
    L += ["## 6. バリデーション・エラーフィードバック設計", "", "* **クライアント側バリデーション**:", ""]
    L += [table(["画面ID", "対象フィールド", "ルール", "正規表現 / 条件", "エラーメッセージ"], s["validations"]) if s["validations"] else "該当なし。" + s.get("no_validation", ""), ""]
    L += ["* **UIエラーフィードバック**:", "", table(["エラー種別", "HTTPステータス", "エラー表示様式", "UI挙動", "表示コンポーネント"], s["errors"]), ""]
    return "\n".join(L)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in SPECS:
        if not os.path.exists(os.path.join(HERE, name + ".py")):
            continue
        s = importlib.import_module(name).SPEC
        assert len(s["components"]) >= 15, (name, "components", len(s["components"]))
        assert len(s["ipo"]) >= 20, (name, "ipo", len(s["ipo"]))
        open(os.path.join(OUT, s["name"] + ".md"), "w", encoding="utf-8").write(render(s))
        print(s["name"], "components", len(s["components"]), "ipo", len(s["ipo"]), "actions", len(s["actions"]))


if __name__ == "__main__":
    main()
