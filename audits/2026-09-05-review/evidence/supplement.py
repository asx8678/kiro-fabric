import pathlib,json,hashlib,subprocess,re,collections,datetime,platform
root=pathlib.Path.cwd(); out=root/'audits/2026-09-05-review/evidence'; manifest=json.loads((out/'baseline-files.json').read_text()); repo=pathlib.Path(json.loads((out/'sandbox.json').read_text())['repo'])
changed=[]
for item in manifest:
 p=root/item['path']
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:changed.append(item['path'])
dist=[i for i in manifest if i['path'].startswith('dist/')]; dist_mismatch=[i['path'] for i in dist if not (repo/i['path']).is_file() or hashlib.sha256((repo/i['path']).read_bytes()).hexdigest()!=i['sha256']]
pkg=json.loads((root/'package.json').read_text()); deps=[]
for group in ['dependencies','devDependencies']:
 for name,constraint in pkg[group].items():
  original=json.loads((root/'node_modules'/name/'package.json').read_text()); disposable=json.loads((repo/'node_modules'/name/'package.json').read_text());deps.append({'name':name,'group':group,'declared':constraint,'originalInstalled':original['version'],'disposableInstalled':disposable['version'],'localLicenseDeclaration':original.get('license','NOASSERTION'),'localEngines':original.get('engines',{})})
patterns={'private-key-header':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),'github-token-format':re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),'aws-access-id-format':re.compile(r'\bAKIA[A-Z0-9]{16}\b')};hits=[];scanned=0
for i in manifest:
 if i['binary'] or i['path'].startswith(('dist/','media/')):continue
 scanned+=1
 for n,line in enumerate((root/i['path']).read_text(errors='replace').splitlines(),1):
  for kind,pattern in patterns.items():
   if pattern.search(line):hits.append({'path':i['path'],'line':n,'type':kind})
current={i['path'] for i in manifest};hot=collections.Counter(p for p in subprocess.check_output(['git','log','--format=','--name-only','--','src','scripts']).decode().splitlines() if p in current)
result={'retrievedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'platform':platform.platform(),'originalFilesChangedSinceSnapshot':changed,'originalDistComparedWithFreshBuild':{'denominatorFiles':len(dist),'mismatches':dist_mismatch},'dependencies':deps,'secretLocationScan':{'method':'three format-only regexes in supplement.py; no values emitted; excludes binary, media, dist, ignored files, dependencies and history','filesScanned':scanned,'hits':hits},'currentFileHistoryHotspots':hot.most_common(10),'binaryFiles':[{'path':i['path'],'bytes':i['bytes']} for i in manifest if i['binary']]}
(out/'supplement.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
