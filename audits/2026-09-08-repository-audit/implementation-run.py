#!/usr/bin/env python3
"""Bounded verification for the subsequently authorized implementation."""
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time

out = pathlib.Path(__file__).resolve().parent
root = out.parent.parent
evidence = out / 'evidence'
cid, timeout, *command = sys.argv[1:]
target = evidence / f'{cid}.json'
assert not target.exists(), cid
temp = pathlib.Path(tempfile.mkdtemp(prefix='kiro-fabric-fix-check-', dir='/tmp'))
for name in ('home', 'kiro', 'tmp', 'cache'):
    (temp / name).mkdir(mode=0o700)
env = {
    'PATH': os.environ['PATH'], 'HOME': str(temp / 'home'), 'KIRO_HOME': str(temp / 'kiro'),
    'TMPDIR': str(temp / 'tmp'), 'XDG_CACHE_HOME': str(temp / 'cache'),
    'LANG': 'C.UTF-8', 'CI': 'true', 'NO_COLOR': '1',
    'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
    'pnpm_config_verify_deps_before_run': 'false',
    'NODE_OPTIONS': '--require=' + str(out / 'package-registry-guard.cjs'),
}
start = time.monotonic()
process = subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
status = 'passed'
try:
    output = process.communicate(timeout=int(timeout))[0]
except subprocess.TimeoutExpired:
    status = 'timed out'
    os.killpg(process.pid, signal.SIGTERM)
    try:
        output = process.communicate(timeout=5)[0]
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        output = process.communicate()[0]
if process.returncode and status != 'timed out':
    status = 'failed'
record = {
    'id': cid, 'phase': 'user-authorized fixes after baseline audit', 'command': command,
    'cwd': str(root), 'environment': env, 'timeout_seconds': int(timeout),
    'status': status, 'exit': process.returncode, 'elapsed_seconds': round(time.monotonic() - start, 3),
    'output': output.decode(errors='replace'),
}
target.write_text(json.dumps(record, indent=2) + '\n')
print(record['output'])
print(json.dumps({k: record[k] for k in ('id', 'status', 'exit', 'elapsed_seconds')}))
sys.exit(0 if status == 'passed' else 1)
