import pathlib,subprocess,re,json
root=pathlib.Path.cwd()
assert str(root).startswith('/tmp/kiro-fabric-audit-')
patterns={
 'private-key-header':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
 'github-token':re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b'),
 'aws-access-key-id':re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
 'slack-token':re.compile(rb'\bxox[baprs]-[0-9A-Za-z-]{20,255}\b'),
}
def included(n):
 return not n.startswith(('dist/','node_modules/','.git/','audits/','tobechecked/','.tmp/')) and pathlib.Path(n).suffix in ('.ts','.mjs','.js','.md','.json','.yml','.yaml','.sh','.toml','.env')
def scan(b,where):
 result=[]
 for kind,pattern in patterns.items():
  for m in pattern.finditer(b):result.append({**where,'type':kind,'line':b[:m.start()].count(b'\n')+1})
 return result
hits=[];current_count=0;current_bytes=0
for p in root.rglob('*'):
 n=str(p.relative_to(root))
 if p.is_file() and not p.is_symlink() and included(n) and p.stat().st_size<=1024*1024:
  b=p.read_bytes();current_count+=1;current_bytes+=len(b);hits+=scan(b,{'scope':'snapshot','path':n})
objects=subprocess.check_output(['git','rev-list','--objects','--all'],timeout=30).decode().splitlines()
seen=set();historical_count=0;historical_bytes=0;skipped=[]
for record in objects:
 a=record.split(' ',1)
 if len(a)!=2 or not included(a[1]) or a[0] in seen:continue
 sha,n=a;seen.add(sha)
 info=subprocess.check_output(['git','cat-file','-s',sha],timeout=10).decode().strip()
 size=int(info)
 if size>1024*1024 or historical_count>=3000 or historical_bytes+size>64*1024*1024:
  skipped.append({'path':n,'bytes':size});continue
 b=subprocess.check_output(['git','cat-file','blob',sha],timeout=10)
 historical_count+=1;historical_bytes+=len(b);hits+=scan(b,{'scope':'history-unique-blob','path':n,'blob':sha})
print(json.dumps({'method':'High-specificity pattern scan only; no entropy/general-secret classification. Values never printed or validated. Current authored text <=1 MiB; all-ref unique historical eligible blobs capped at 3000/64 MiB. Object paths are representative Git names, not exhaustive historical aliases. Excludes generated/dependencies/prior audits.', 'patterns':list(patterns),'currentFiles':current_count,'currentBytes':current_bytes,'historicalBlobs':historical_count,'historicalBytes':historical_bytes,'skippedByBound':skipped,'candidates':hits},indent=2))
