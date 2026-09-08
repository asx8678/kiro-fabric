"""Correct audit-only relocation: pnpm recognizes a store ending in v11."""
import json
import pathlib
import shutil

root = pathlib.Path.cwd()
assert str(root).startswith('/tmp/kiro-fabric-audit-')
modules = root / 'node_modules/.modules.yaml'
metadata = json.loads(modules.read_text())
before = pathlib.Path(metadata['storeDir'])
assert before == root.parent / 'private-pnpm-store'
assert (before / 'files').is_dir()
assert (before / 'index.db').is_file()
after = root.parent / 'corrected-pnpm-store' / 'v11'
assert not after.exists()
after.parent.mkdir(mode=0o700)
shutil.copy2(modules, root / '.tmp/modules-before-v11-correction.json')
before.rename(after)
metadata['storeDir'] = str(after)
modules.write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps({
    'action': 'Preserve the v11 suffix of the already copied pnpm store; move only audit-owned temporary files',
    'before': str(before), 'after': str(after),
    'repositoryInputsChanged': False,
    'reason': 'C-096 and C-097 show pnpm appends /v11 unless the supplied store path already ends in v11',
}))
