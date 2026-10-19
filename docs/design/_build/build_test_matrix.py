#!/usr/bin/env python3
"""受入基準（04_受入基準.md）から、テスト計画の受入基準ごとの割り当て表を作る。"""
import re, sys
src = '/Users/kainetaylor/AISNS/docs/requirements/04_受入基準.md'
rows = [l for l in open(src, encoding='utf-8').read().split('\n') if re.match(r'^\| AC-', l)]
# 状態遷移（AC-T）は IT。それ以外は検証区分で決める
STAGE = {'V1': ('IT', '自動', 'Vitest（固定応答）。画面の項目は Playwright（固定応答）'),
         'V5': ('IT', '自動', 'Vitest（固定応答の失敗の再現、多重実行の注入）'),
         'V3': ('ST', '手動', 'UI レビュー（観点表で目視。PC 3 種・スマートフォン 2 種）'),
         'V7': ('ST', '自動＋手動', 'Playwright と curl。LAN の別の端末と、外部のネットワーク（スマートフォンの回線）から接続'),
         'V6': ('ST', '自動', 'k6 で観察 API と管理 API に負荷。固定応答と実モデルで別に測る'),
         'V2': ('UAT', '手動', '実モデル（Cloudflare）で世界内時間の連続 2 時間。Jane Doe が判定し Kaine Yamashiro が承認'),
         'V4': ('UAT', '手動', '初めて使う2名（Kaine Yamashiro と招待者1名）の操作テスト')}
OVERRIDE = {
    ('AC-L01', 'V7'): ('ST', '手動', 'Cloudflare のダッシュボードで、Workers Free プランのままで有料の利用がないことを確かめる。アカウントは Kaine Yamashiro のため、画面の確認を Kouhei Tajima 経由で依頼する'),
    ('AC-S03', 'V7'): ('ST', '自動', 'pnpm build の依存パッケージの確認の結果（build/audit.txt）を確かめる'),
    ('AC-210', 'V7'): ('ST', '自動', '世界を 1 時間動かし、端末の通信の記録（macOS の nettop）で接続先が api.cloudflare.com だけであることを確かめる'),
    ('AC-S09', 'V7'): ('ST', '自動＋手動', '通信の記録（nettop）と、LAN の別の端末・外部のネットワーク（スマートフォンの回線）からの接続の試行'),
    ('AC-S07', 'V7'): ('ST', '自動＋手動', 'Playwright で全画面の HTML・通信・スクリプトを検索。LAN の別の端末から 8081 に接続できないことを確かめる'),
}
out = ['| AC | 対象 | 検証区分 | 段階 | 実施 | 手段 |', '|---|---|---|---|---|---|']
cnt = {}
for l in rows:
    c = [x.strip() for x in l.split('|')]
    ac, target = c[1], c[2]
    if ac.startswith('AC-T'):
        vs = ['V1']
    else:
        vs = re.findall(r'V[1-7]', ' '.join(c[3:-2]))
        vs = sorted(set(vs)) or ['V1']
    for v in vs:
        st, how, means = OVERRIDE.get((ac, v), STAGE[v])
        out.append(f'| {ac} | {target} | {v} | {st} | {how} | {means} |')
        cnt[st] = cnt.get(st, 0) + 1
print('\n'.join(out))
print(f'\n受入基準 {len(rows)} 件、割り当て {len(out) - 2} 行（' + '・'.join(f'{k} {v}' for k, v in sorted(cnt.items())) + '）', file=sys.stderr)
