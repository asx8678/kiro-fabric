import hashlib
import json
import os
import pathlib
import subprocess

out = pathlib.Path(__file__).resolve().parent
root = out.parent.parent
before = {r['path']: r for r in json.loads((out / 'evidence/baseline-manifest.json').read_text())}
names = set(subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')) - {''}
changed = []
for name in sorted(names | before.keys()):
    if name.startswith('audits/2026-09-08-repository-audit/'):
        continue
    file = root / name
    if file.is_symlink():
        record = {'path': name, 'kind': 'symlink', 'target': os.readlink(file)}
    elif not file.exists():
        record = {'path': name, 'kind': 'absent'}
    else:
        data = file.read_bytes()
        record = {'path': name, 'kind': 'file', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'lines': len(data.splitlines()), 'mode': oct(file.stat().st_mode & 0o777)}
    if record != before.get(name):
        changed.append(name)
expected = {'src/kiro/memory.ts', 'src/kiro/mcp-provider.ts', 'src/kiro/artifacts.ts', 'tests/storage-failure.test.ts'}
authored = {name for name in changed if not name.startswith('dist/')}
concurrent_additions = {
    'audits/2026-09-08-code-quality-fanout/' + name
    for name in ('REPORT.md', 'coverage.json', 'findings.json', 'reviews.json', 'snapshot.sha256', 'verification.json')
}
observed_additions = {name for name in authored & concurrent_additions if name not in before}
implementation_changes = authored - observed_additions
result = {
    'ok': implementation_changes == expected,
    'whole_tree_unchanged_outside_implementation': authored == expected,
    'authored_changes': sorted(implementation_changes),
    'concurrent_audit_additions': sorted(observed_additions),
    'generated_changes': [name for name in changed if name.startswith('dist/')],
    'unexpected_changes': sorted(implementation_changes - expected),
    'method': 'Compare original audit baseline hashes, modes, symlink/absence records and current tracked/untracked file inventory. Check the four authorized source/test files and generated dist; report six separately observed additions from another audit. Those files were absent from the baseline and were not written by this task. Whole-tree preservation is false when these concurrent additions exist; no files are restored or removed.',
}
(out / 'evidence/implementation-preservation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['ok'] else 1)
