#!/usr/bin/env python3
"""単体テストの観点表（JSON）から、同じ名前の Markdown と Excel を作る。

  python3 docs/test/unit/_build/build_matrix.py docs/test/unit/NOUS-xx/観点表_<対象>.json [...]

- JSON が正。Markdown と Excel は、このスクリプトで作り直す（手で直さない）。
- Excel は test-case-generator スキルの export_test_matrix.py で書き出す。スキルの列にない
  NOUS の列（precondition・dev_ref・suspect）は、Excel では「入力・前提条件」と「備考」にまとめて載せる。
- スキルの場所は環境変数 TCG_DIR、なければ Claude のスキルの置き場所を探す。
- Excel の書き出しには openpyxl が要る。環境変数 TCG_PYTHON（既定 ~/project/.venv-test/bin/python）で動かす。
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

TCG_GLOB = os.path.expanduser(
    "~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/*/*/skills/test-case-generator"
)


def find_tcg() -> str:
    if os.environ.get("TCG_DIR"):
        return os.environ["TCG_DIR"]
    found = sorted(glob.glob(TCG_GLOB), key=os.path.getmtime)
    if not found:
        sys.exit("test-case-generator スキルが見つかりません。TCG_DIR にスキルのディレクトリを指定してください")
    return found[-1]


def cell(value) -> str:
    """Markdown の表のセル。改行と | を崩れない形にする"""
    if value is None:
        return ""
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value)
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def to_markdown(m: dict) -> str:
    cases = m.get("cases", [])
    lines = [f"# 単体テスト観点表：{m.get('title', '')}", ""]
    lines += ["| 項目 | 内容 |", "|---|---|"]
    for label, key in (
        ("関連チケット", "ticket"),
        ("作成者", "author"),
        ("作成日", "created_on"),
        ("対象", "targets"),
        ("言語 / フレームワーク", "framework"),
        ("テストファイル", "test_files"),
        ("外部依存", "dependencies"),
        ("入力にした設計書", "design_refs"),
    ):
        lines.append(f"| {label} | {cell(m.get(key, ''))} |")
    lines += ["", "このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。", ""]

    branches = m.get("branches", [])
    lines += ["## 1. 分岐の一覧", ""]
    if branches:
        lines += ["| ID | 条件 | 場所 |", "|---|---|---|"]
        lines += [f"| {cell(b.get('id'))} | {cell(b.get('condition'))} | {cell(b.get('location'))} |" for b in branches]
    else:
        lines.append("分岐なし")

    new = sum(1 for c in cases if not c.get("id", "").count("_DEV-"))
    lines += ["", f"## 2. ケースの一覧（{len(cases)} 件。うち新しく足したもの {new} 件）", ""]
    header = ["ID", "対象", "分類", "技法", "観点", "前提", "入力", "期待結果", "分岐", "モック", "既存テストとの対応", "バグの疑い", "テスト名", "備考"]
    keys = ["id", "target", "category", "technique", "viewpoint", "precondition", "input", "expected", "branches", "mock", "dev_ref", "suspect", "test_name", "note"]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("|" + "---|" * len(header))
    for c in cases:
        lines.append("| " + " | ".join(cell(c.get(k, "")) for k in keys) + " |")

    issues = m.get("issues", [])
    lines += ["", "## 3. 確認事項・バグの疑い", ""]
    lines += [f"- {i}" for i in issues] if issues else ["なし"]
    return "\n".join(lines) + "\n"


def to_export(m: dict) -> dict:
    """スキルの Excel の列に合わせる（前提は入力に、既存テストとの対応・疑いは備考に寄せる）"""
    out = json.loads(json.dumps(m))
    for c in out.get("cases", []):
        pre, inp = c.pop("precondition", ""), c.get("input", "")
        c["input"] = "\n".join(x for x in (f"前提：{pre}" if pre else "", f"入力：{inp}" if inp else "") if x)
        notes = []
        if c.get("dev_ref"):
            notes.append(f"既存テスト：{c['dev_ref']}")
        if c.get("suspect"):
            notes.append(f"疑い：{c['suspect']}")
        if c.get("note"):
            notes.append(c["note"])
        c.pop("dev_ref", None)
        c.pop("suspect", None)
        c["note"] = "\n".join(notes)
    return out


def build(json_path: str, tcg: str, python: str) -> None:
    with open(json_path, encoding="utf-8") as f:
        m = json.load(f)
    base, _ = os.path.splitext(json_path)
    with open(base + ".md", "w", encoding="utf-8") as f:
        f.write(to_markdown(m))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(to_export(m), tmp, ensure_ascii=False, indent=2)
    try:
        subprocess.run([python, os.path.join(tcg, "scripts", "export_test_matrix.py"), tmp.name, base + ".xlsx"], check=True)
    finally:
        os.unlink(tmp.name)
    print(f"{base}.md / .xlsx を作りました")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    tcg = find_tcg()
    python = os.environ.get("TCG_PYTHON", os.path.expanduser("~/project/.venv-test/bin/python"))
    for path in sys.argv[1:]:
        build(path, tcg, python)


if __name__ == "__main__":
    main()
