import pathlib,re,json,hashlib,datetime,sys
root=pathlib.Path.cwd(); out=root/'audits/2026-09-05-review'; ev=out/'evidence'
report=(out/'REPOSITORY_AUDIT.md').read_text(); notes=(out/'AUDIT_NOTES.md').read_text(); problems=[]
refs=re.findall(r'([A-Za-z0-9_@./-]+\.(?:ts|js|mjs|json|yaml|yml|md)):(\d+)(?:-(\d+))?',report)
for f,a,b in refs:
 p=root/f
 if not p.is_file(): problems.append('missing citation: '+f); continue
 if not (1<=int(a)<=int(b or a)<=len(p.read_text().splitlines())):problems.append('invalid citation range: '+f+':'+a+'-'+b)
for link in re.findall(r'\]\(([^)]+)\)',report):
 if not link.startswith(('https:','http:','#')) and not (out/link).exists():problems.append('missing local link: '+link)
ids=set(re.findall(r'\bC\d{3}\b',report+notes)); missing=[i for i in ids if i not in ['C001','C002','C003','C018'] and not (ev/(i+'.json')).is_file()]
problems.extend('missing command: '+i for i in missing)
heads=re.findall(r'^### (F-\d{3}) —',report,re.M); referenced=set(re.findall(r'\bF-\d{3}\b',report))
if len(heads)!=len(set(heads)) or set(heads)!=referenced:problems.append('finding ID definition/reference mismatch')
expected=['Verified within tested scope','Statically traced only','Partially verified','Confirmed defect','Not verified','Not applicable']
section=report.split('## 5. Feature Verification Matrix')[1].split('## 6.')[0]
for line in section.splitlines():
 if line.startswith('| ') and not line.startswith('| Feature'):
  if not any('| '+s+' |' in line for s in expected):problems.append('invalid feature status: '+line[:80])
manifest=json.loads((ev/'baseline-files.json').read_text());changed=[]
for i in manifest:
 p=root/i['path']
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=i['sha256']:changed.append(i['path'])
if changed:problems.append('original baseline changed')
ledger=json.loads((ev/'read-ledger.json').read_text());normalized=[]
for group in ledger.values():
 if not isinstance(group,dict):continue
 for file,ranges in group.get('windows',{}).items():
  n=len((root/file).read_text().splitlines())
  for window in ranges:
   if window[1]>n: normalized.append({'file':file,'requestedEnd':window[1],'actualEnd':n});window[1]=n
(ev/'read-ledger.json').write_text(json.dumps(ledger,indent=2)+'\n')
sdk=[]
for name,a,b in [('dist/esm/types.d.ts',2416,2464),('dist/esm/client/index.js',550,558),('package.json',1,25)]:
 p=root/'node_modules/@modelcontextprotocol/sdk'/name; lines=p.read_text().splitlines();sdk.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'start':a,'end':b,'excerpt':'\n'.join(f'{n+1}: {lines[n]}' for n in range(a-1,b))})
(ev/'sdk-pagination-evidence.json').write_text(json.dumps(sdk,indent=2)+'\n')
patterns=[r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',r'\bAKIA[A-Z0-9]{16}\b']; sensitive=[]
for file in out.rglob('*'):
 if not file.is_file() or file.suffix not in ['.md','.json','.txt']:continue
 text=file.read_text(errors='replace')
 for n,line in enumerate(text.splitlines(),1):
  if any(re.search(p,line) for p in patterns):sensitive.append({'path':str(file.relative_to(out)),'line':n})
if sensitive:problems.append('format-only sensitive data scan needs review')
result={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'citationsChecked':len(refs),'findingDefinitions':heads,'commandIds':sorted(ids),'originalFilesChecked':len(manifest),'originalFilesChanged':changed,'ledgerEndsNormalized':normalized,'formatOnlySensitiveLocationHits':sensitive,'problems':problems,'status':'passed' if not problems else 'failed','note':'Mechanical validation is not a complete secret scan or semantic proof.'}
print(json.dumps(result,indent=2));sys.exit(bool(problems))
