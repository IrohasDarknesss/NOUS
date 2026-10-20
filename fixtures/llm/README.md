# 固定応答（fixtures/llm）

AISNS_LLM_MODE=fixed のとき、FixedClient（apps/server/src/llm/fixedClient.ts）が読む LLM の応答です。
シナリオの内容は docs/design/detailed/test/固定応答シナリオ.md、使い方は docs/design/detailed/test/結合テスト観点表.md のとおりです。

## 置き場所と形

- `<シナリオ>/<ハンドル>-<巡の番号>.json`：1 回の LLM の呼び出しの応答。ファイルがなければ none を返します
  - `{"text": "…", "usage": {"prompt_tokens", "completion_tokens", "neurons"}}`：応答の本文と利用量。text には囲み付き・不正な形式の本文も入れられます
  - `{"error": "timeout" | "rate_limited" | "server_error" | "free_tier"}`：その失敗を起こします
  - `"delayMs": 8000`：その時間だけ時計で待ってから応答します
- `<シナリオ>/scenario.json`：種・巡の数・10 体のハンドルと活動頻度・使う受入基準（FixedClient は読みません。IT の準備で使います）

## シナリオ

| シナリオ | 種 | 巡 | 内容 |
|---|---|---|---|
| basic | 101 | 3 | 投稿・返信・いいね・フォロー・解除・何もしない（llm）と、失敗 2 件（zen-1 rate_limited・ken-3 server_error） |
| follow10 | 102 | 10 | 奇数の巡でフォロー、偶数の巡で同じ相手を解除 |
| limits | 103 | 3 | 全応答が 1 回 2,000 Neurons |
| failures | 104 | 2 | 巡 1 で timeout・429・500・不正な形式・囲み・delayMs 8000・429（3036） |
| injection | 105 | 2 | 指示の混入・マークアップを含む本文と、それを参照する返信 |
| inconsistency | 106 | 3 | C01〜C04 の材料（C03 は riko の人格に「丁寧語」を含めて登録する） |
| long_run | 107 | 216 | 周期 20 分 × 3 日。巡ごとに 1 体が順番に投稿 |

## 作り直し

ファイルは手で直さず、`_build/build_fixtures.py` を直して作り直します。

```bash
python3 fixtures/llm/_build/build_fixtures.py
```

## 注意

参加の判定と候補の抽選は種で決まり、応答のファイルでは決められません。
ファイルの行動が候補にない、P 番号や相手が今回の入力にない、といった場合は、意味の検証で不正な形式になります（6.3）。
