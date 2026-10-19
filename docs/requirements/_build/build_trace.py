"""05_その他_トレーサビリティ.md の 8.2〜8.4 を、各章ファイルの表から作り直す。"""
import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
def rows(f, pre):
    return [[x.strip() for x in l.split('|')[1:-1]] for l in open(f, encoding='utf-8') if l.startswith(pre)]
BR = {c[0]: c[1] for c in rows('01_業務要件.md', '| BR-0')}
BUS = {c[0]: c[5] for c in rows('01_業務要件.md', '| BUS-')}
FR = {c[0]: (c[4], c[5]) for c in rows('02_機能要件.md', '| FR-')}
NFR = {c[0]: c[4] for c in rows('03_非機能要件.md', '| NFR-')}
AC = [(c[0], c[1]) for c in rows('04_受入基準.md', '| AC-')]
def expand(s):
    out = set(re.findall(r'BUS-\d{3}', s))
    for a, b in re.findall(r'BUS-(\d{3})〜BUS-(\d{3})', s):
        out |= {f'BUS-{i:03d}' for i in range(int(a), int(b) + 1)}
    return out
NMAP = {
 'BR-001': ('LLM の障害時も社会が続き、データが壊れないこと', ['NFR-A-003','NFR-A-006','NFR-A-007','NFR-P-001','NFR-P-003','NFR-L-004']),
 'BR-002': ('観察者が閲覧できる水準', ['NFR-A-001','NFR-P-002','NFR-P-004','NFR-P-005','NFR-P-008','NFR-S-006','NFR-S-011','NFR-U-001','NFR-U-003','NFR-U-004']),
 'BR-003': ('行動に属性と記憶を反映するための入力の制御', ['NFR-L-005']),
 'BR-004': ('費用・安全・運用の管理', ['NFR-A-002','NFR-A-004','NFR-A-005','NFR-P-006','NFR-P-007','NFR-O-001','NFR-O-002','NFR-O-003','NFR-O-006','NFR-O-007','NFR-O-009','NFR-O-010','NFR-S-002','NFR-S-003','NFR-S-004','NFR-S-007','NFR-S-008','NFR-S-010','NFR-S-013','NFR-S-014','NFR-E-001','NFR-E-002','NFR-E-004','NFR-L-001','NFR-L-002','NFR-L-006']),
 'BR-005': ('AI の明示と外部への影響の防止', ['NFR-S-001','NFR-S-005','NFR-S-009','NFR-S-012','NFR-U-002']),
 'BR-006': ('行動の検証と追跡', ['NFR-O-004','NFR-O-005','NFR-O-008','NFR-O-011','NFR-L-003']),
}
NONE = ['NFR-M-001','NFR-M-002','NFR-M-003','NFR-E-003','NFR-E-005']
allm = [n for v in NMAP.values() for n in v[1]] + NONE
assert len(allm) == len(set(allm)) and set(allm) == set(NFR), (set(NFR) ^ set(allm))
acmap = {}
for a, t in AC:
    for x in re.findall(r'(?:FR|NFR-[A-Z])-\d{3}', t): acmap.setdefault(x, []).append(a)
bad_fr = [f for f, (b, p) in FR.items() if not expand(b) or not expand(b) <= set(BUS)]
bad_bus = [b for b, r in BUS.items() if not set(re.findall(r'BR-\d{3}', r)) <= set(BR) or not re.search(r'BR-\d{3}', r)]
unused = sorted(set(BUS) - set().union(*[expand(b) for b, p in FR.values()]))
m1 = ['| BR | BUS | FR | NFR | 受入基準（AC） |', '|---|---|---|---|---|']
for br in BR:
    bus = sorted(b for b, r in BUS.items() if br in r)
    fr = sorted(f for f, (b, p) in FR.items() if expand(b) & set(bus))
    nfr = NMAP[br][1]
    acs = sorted({a for x in fr + nfr for a in acmap.get(x, [])})
    m1.append(f'| {br} | {", ".join(bus)} | {", ".join(fr)} | {", ".join(nfr)} | {", ".join(acs) or "—"} |')
m2 = ['| BR | 非機能要件が支える観点 | NFR |', '|---|---|---|']
for br, (why, ns) in NMAP.items(): m2.append(f'| {br} | {why} | {", ".join(ns)} |')
m2.append(f'| （なし） | 該当なしの項目（移行がない、準拠規格・環境配慮の要求がない） | {", ".join(NONE)} |')
mustfr = [f for f, (b, p) in FR.items() if p.startswith('Must')]
mustn = [n for n, p in NFR.items() if p.startswith('Must')]
non = [n for n in mustn if n not in acmap]
m3 = ['| 照合 | 結果 |', '|---|---|',
 f'| FR の関連 BUS が業務要件に実在するか | {len(FR)-len(bad_fr)}/{len(FR)} 件が実在 |',
 f'| BUS の関連 BR が実在するか | {len(BUS)-len(bad_bus)}/{len(BUS)} 件が実在 |',
 f'| どの FR からも参照されない BUS | {", ".join(unused) or "なし"} |',
 f'| NFR がいずれかの BR に対応するか | {len(NFR)} 件中 {len(NFR)-len(NONE)} 件が対応。残り {len(NONE)} 件は該当なしの項目（8.3） |',
 f'| Must の FR に受入基準があるか | {sum(1 for f in mustfr if f in acmap)}/{len(mustfr)} 件 |',
 f'| Must の NFR に受入基準があるか | {len(mustn)} 件中 {len(mustn)-len(non)} 件にあり。残り {len(non)} 件は付録 A.4（基準が未確定）と A.5（受入基準を設けない要件）に掲載 |',
 '| BR まで追えない FR・NFR（スコープ外候補） | なし |' if not bad_fr else f'| BR まで追えない FR | {", ".join(bad_fr)} |']
# check A.4/A.5 listing matches
a45 = open('04_受入基準.md', encoding='utf-8').read()
a45 = a45[a45.index('### A.4'):a45.index('### A.6')]
listed = set(re.findall(r'NFR-[A-Z]-\d{3}', a45))
for x, y in re.findall(r'(NFR-[A-Z])-(\d{3})〜NFR-[A-Z]-(\d{3})', a45) and []: pass
missing = sorted(set(non) - listed)
assert not missing, ('Must NFR without AC not in A.4/A.5', missing)
p = '05_その他_トレーサビリティ.md'; s = open(p, encoding='utf-8').read()
def put(sec, nxt, table):
    global s
    i = s.index(sec); j = s.index(nxt, i)
    s = s[:i] + sec + '\n\n' + '\n'.join(table) + '\n\n' + s[j:]
put('### 8.2 BR → BUS → FR → NFR → 受入基準', '### 8.3', m1)
put('### 8.3 非機能要件とビジネス要求の対応', '### 8.4', m2)
put('### 8.4 照合の結果', '\n---\n', m3)
open(p, 'w', encoding='utf-8').write(s)
print('\n'.join(m3))
