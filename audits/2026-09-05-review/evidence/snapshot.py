import os, pathlib, subprocess, hashlib, json, tempfile, shutil
root=pathlib.Path.cwd(); out=root/'audits/2026-09-05-review/evidence'
paths=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard']).decode().split('\0')
paths=sorted(set(p for p in paths if p and not p.startswith('audits/')))
manifest=[]
for p in paths:
 f=root/p
 if f.is_file() and not f.is_symlink():
  b=f.read_bytes(); manifest.append(dict(path=p,bytes=len(b),lines=len(b.splitlines()),sha256=hashlib.sha256(b).hexdigest(),binary=(b'\0' in b)))
(out/'baseline-files.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'baseline-status.txt').write_bytes(subprocess.check_output(['git','status','--short','--untracked-files=all']))
counts={}
for prefix in ['src/','tests/','scripts/','docs/','.github/','dist/']:
 a=[x for x in manifest if x['path'].startswith(prefix)]; counts[prefix]={'files':len(a),'lines':sum(x['lines'] for x in a),'bytes':sum(x['bytes'] for x in a)}
counts['largest_non_generated']=sorted([x for x in manifest if not x['path'].startswith('dist/')],key=lambda x:x['bytes'],reverse=True)[:8]
(out/'inventory.json').write_text(json.dumps(counts,indent=2)+'\n')
sandbox=pathlib.Path(tempfile.mkdtemp(prefix='kiro-fabric-audit-')); os.chmod(sandbox,0o700)
repo=sandbox/'repo'; repo.mkdir()
for p in paths:
 f=root/p
 if f.is_file() and not f.is_symlink():
  target=repo/p; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(f,target)
shutil.copytree(root/'node_modules',repo/'node_modules',symlinks=True)
for p in ['home','tmp','kiro-home']: (sandbox/p).mkdir(mode=0o700)
(out/'sandbox.json').write_text(json.dumps({'sandbox':str(sandbox),'repo':str(repo)},indent=2)+'\n')
print(json.dumps({'sandbox':str(sandbox),'counts':counts},indent=2))
