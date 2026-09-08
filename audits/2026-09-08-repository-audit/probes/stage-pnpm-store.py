import pathlib,json,shutil
root=pathlib.Path.cwd()
assert str(root).startswith('/tmp/kiro-fabric-audit-')
modules=root/'node_modules/.modules.yaml'
metadata=json.loads(modules.read_text())
original=pathlib.Path(metadata['storeDir'])
target=root.parent/'private-pnpm-store'
assert not target.exists()
files=list(original.rglob('*'))
size=sum(p.stat().st_size for p in files if p.is_file() and not p.is_symlink())
assert len(files)<=60000 and size<=1024*1024*1024
shutil.copytree(original,target,symlinks=True)
shutil.copy2(modules,root/'.tmp/modules-before-private-store.json')
metadata['storeDir']=str(target)
modules.write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'action':'Copied package store and redirected only disposable dependency metadata; no project source/config/test changes','filesAndDirectories':len(files),'bytes':size,'privateStore':str(target),'metadataPath':str(modules)}))
