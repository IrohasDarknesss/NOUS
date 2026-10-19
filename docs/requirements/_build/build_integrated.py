import re,sys,os
os.chdir('/Users/kainetaylor/AISNS/docs/requirements')
VER=sys.argv[1] if len(sys.argv)>1 else 'v0.1'
HIST=sys.argv[2] if len(sys.argv)>2 else ''
def body(f):
    s=open(f,encoding='utf-8').read()
    i=s.index('## 改訂履歴'); j=s.index('\n---\n',i)+5
    b=s[j:].strip('\n')
    k=b.find('## 本章で起票する確認事項')
    if k>=0:
        rng=sorted(set(re.findall(r'^\| (Q-\d{3}) \|',b[k:],re.M)))
        b=b[:k].rstrip('\n').rstrip('-').rstrip('\n')+f'\n\n> 本章で起票した確認事項（{rng[0]}〜{rng[-1]}）は 9章に集約した。\n'
    b=re.sub(r'0[1-6]_[^ 　）、。|]+\.md ','',b)
    return b
def ver(f): return re.search(r'\| 版数 \| (v[\d.]+) \|',open(f,encoding='utf-8').read()).group(1)
files=['01_業務要件.md','02_機能要件.md','03_非機能要件.md','05_その他_トレーサビリティ.md','06_確認事項一覧.md','04_受入基準.md']
v={f:ver(f) for f in files}
b4=body('04_受入基準.md').replace('## 受入基準と検証方法','## 付録A 受入基準と検証方法',1)
src='、'.join(f'{f} {v[f]}' for f in files)
hist=f'| v0.1 | 2026-10-19 | 初版。章ファイルを統合 | Mark Zuckerberg |'
if HIST: hist+='\n'+HIST.replace('{SRC}',src)
else: hist=f'| v0.1 | 2026-10-19 | 初版。章ファイル {src} を統合 | Mark Zuckerberg |'
head=open(os.path.dirname(os.path.abspath(__file__))+'/head.md',encoding='utf-8').read().replace('{VER}',VER).replace('{HIST}',hist)
tail=open(os.path.dirname(os.path.abspath(__file__))+'/tail.md',encoding='utf-8').read()
out=head+'\n\n---\n\n'.join(body(f) for f in files[:5])+tail+b4+'\n'
open(f'要件定義書_NOUS_{VER}.md','w',encoding='utf-8').write(out)
print('built',VER,out.count('\n'),'lines')
