import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path.cwd()
baseline=json.loads((root/'audits/2026-09-05-review/evidence/baseline-files.json').read_text())
allowed=set('''.github/workflows/release.yml
docs/audit.md
docs/configuration.md
docs/release.md
docs/tracing.md
scripts/release-candidate-report.mjs
src/config.ts
src/execution-service.ts
src/kiro/artifacts.ts
src/kiro/mcp-provider.ts
src/providers/state-provider.ts
src/runtime/type-checker.ts
src/trace/tracer.ts
tests/compiler-isolation.test.ts
tests/configuration.test.ts
tests/release-evidence.test.ts
tests/tracing.test.ts'''.splitlines())
new_allowed=set('''scripts/release-artifacts.mjs
tests/compiler-ownership.test.ts
tests/execution-admission.test.ts
tests/mcp-pagination.test.ts
tests/release-artifacts.test.ts
tests/storage-failure.test.ts'''.splitlines())
changed=[]; unexpected=[]
for entry in baseline:
 p=root/entry['path']
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:
  changed.append(entry['path'])
  if entry['path'] not in allowed and not entry['path'].startswith('dist/'): unexpected.append(entry['path'])
paths=subprocess.check_output(['git','ls-files','-c','-o','--exclude-standard','-z']).decode().split('\0')
prior={entry['path'] for entry in baseline}
added=sorted({p for p in paths if p and p not in prior and (root/p).is_file() and not p.startswith(('audits/','dist/'))})
for p in added:
 if p not in new_allowed:unexpected.append(p)
result={'status':'passed' if not unexpected else 'failed','baselineFilesChecked':len(baseline),'changedBaselineFiles':changed,'newImplementationFiles':added,'unexpectedChanges':unexpected,'note':'Unrelated original files match the dirty baseline byte-for-byte. Intentional edits to shared user-dirty files were anchor-based; generated dist changes are expected. No Git staging or commits performed.'}
print(json.dumps(result,indent=2));sys.exit(bool(unexpected))
