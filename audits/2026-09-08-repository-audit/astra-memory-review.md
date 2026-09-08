# Independent Astra review: memory F-001 remediation

**Final disposition: the additional identity-failure case below is fixed and independently reverified.** The original reproduction is preserved; see the post-correction disposition at the end.

Reviewed the live working-tree diff and `src/kiro/memory.ts`, the four new memory cases in `tests/storage-failure.test.ts`, and relevant recovery/acknowledgement tests. This report describes the implementation before the parent's subsequent review corrections. Source/test/build files were not edited. The parent owns final validation and build.

## Finding: P3 — Initial temporary identity failure leaves forgotten residue

**Confidence: High; reproduced with synthetic data.** `src/kiro/memory.ts:605` adds a fallible `fstatSync` immediately after exclusive temporary creation. If this first identity read throws, `createdStats` remains undefined. The catch at line 615 closes the only owned descriptor before retrying identity acquisition, and the deletion condition at lines 618–620 then skips the owned temporary file. No pending cleanup record survives the call. A successful subsequent `set` leaves that file behind; the entry enumerator at line 631 ignores its `.tmp` suffix.

The probe injected one EIO at the newly added temporary-file `fstatSync`, with all following filesystem calls healthy. Result: original error preserved, no committed acknowledgement, previous value `old` retained, one close attempt, and one zero-byte temporary file both before and after a successful retry publishing `new`. This is a small storage-residue regression, not demonstrated data loss, a descriptor leak, or a disclosure. Repeated failures can accumulate directory entries outside entry quota accounting.

**Smallest safe correction:** when the catch still owns the descriptor but lacks `createdStats`, retry `fstatSync` against that descriptor before closing it. Preserve any retry failure alongside the primary error, then perform the one-attempt close and existing pathname identity check. Do not infer ownership solely from a later pathname stat. If identity remains unavailable, conservative preservation plus explicit unresolved-cleanup diagnostics is appropriate; blind deletion is not. The existing owned-file helper and memory lock recovery establish compatible identity-first patterns.

Add focused cases for a one-shot initial fstat failure (old value and primary error preserved, one close, no residue, successful later write), a foreign pathname replacement during that first failed fstat (replacement preserved), and persistent identity failure (primary and cleanup errors retained, no blind deletion).

## Checks with no additional finding

- `memory.ts:596–601`: descriptor ownership is cleared before close, so a completed close that throws cannot trigger a second close of a reused descriptor.
- `memory.ts:613–624`: writing/sync/close errors survive directly when cleanup succeeds; secondary close/removal errors are collected with the original cause. Cleanup is attempted independently of close success.
- `memory.ts:604,617–620`: exclusive creation plus recorded descriptor identity prevents adopting an existing collision or deleting a different regular file/symlink already occupying the temporary pathname at cleanup inspection. The new replacement test keeps the original inode alive, avoiding accidental inode-reuse ambiguity.
- `memory.ts:608–612,794–802`: close and precommit checks precede rename; `published` becomes true immediately after successful rename and before directory syncing. Failures before publication retain the old entry; postpublication failure becomes `KiroMemoryCommitAcknowledgementError`. The new catch does not reset that flag or remove the committed destination.
- `memory.ts:187–332`: outer lock release still runs after temporary-write failure. Primary failure plus lock-release failure is aggregated; same-instance pending-lock recovery is unchanged.
- `tests/storage-failure.test.ts:91–162` meaningfully exercises completed-close EIO, simultaneous write/close failure, close/removal failure, and foreign replacement preservation. Failure assertions check exact primary identity or ordered aggregate causes, one close attempt, old value preservation and relevant retry behavior.
- Existing `tests/memory-recovery.test.ts` covers pre/postpublication interruption, directory sync behavior, lock cleanup recovery and lock identity uncertainty. `tests/memory-acknowledgement.test.ts` covers propagation through execution/projection. No new acknowledgement regression was established.

## Exact probe command and result

Executed in `/home/adam/projects/kiro-fabric`, exit 0. Bundling reads unchanged source and writes only the disposable `/tmp` directory. No package install or broad test rerun was performed.

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const root=fs.mkdtempSync('/tmp/astra-memory-review-');
const output=path.join(root,'memory.mjs');
await build({entryPoints:['src/kiro/memory.ts'],bundle:true,platform:'node',format:'esm',outfile:output,logLevel:'silent'});
const {openKiroMemory}=await import(output);
const memory=openKiroMemory('workspace',path.join(root,'data'));
await memory.set('fixture','old');
const originalOpen=fs.openSync,originalStat=fs.fstatSync,originalClose=fs.closeSync;
let target,attempts=0,closeAttempts=0;
const failure=Object.assign(new Error('synthetic one-shot temporary fstat EIO'),{code:'EIO'});
fs.openSync=function(file,...args){const fd=originalOpen.call(fs,file,...args); if(path.basename(String(file)).startsWith('.fixture.json.')&&String(file).endsWith('.tmp'))target=fd;return fd;};
fs.fstatSync=function(fd,...args){if(fd===target&&attempts++===0)throw failure;return originalStat.call(fs,fd,...args);};
fs.closeSync=function(fd){if(fd===target)closeAttempts++;return originalClose.call(fs,fd);};
let thrown;
try{await memory.set('fixture','new');}catch(error){thrown=error;}finally{fs.openSync=originalOpen;fs.fstatSync=originalStat;fs.closeSync=originalClose;}
const remaining=()=>fs.readdirSync(path.join(root,'data'),{recursive:true,encoding:'utf8'}).filter(file=>file.endsWith('.tmp'));
const before=(await memory.get('fixture')).value;
const residueBefore=remaining();
await memory.set('fixture','new');
console.log(JSON.stringify({root,errorIsOriginal:thrown===failure,error:thrown?.message,committed:thrown?.committed??false,statAttempts:attempts,closeAttempts,before,residueBefore,retryValue:(await memory.get('fixture')).value,residueAfter:remaining(),residueSizes:remaining().map(file=>fs.statSync(path.join(root,'data',file)).size)},null,2));
NODE
```

```json
{
  "root": "/tmp/astra-memory-review-Tq5I1e",
  "errorIsOriginal": true,
  "error": "synthetic one-shot temporary fstat EIO",
  "committed": false,
  "statAttempts": 1,
  "closeAttempts": 1,
  "before": "old",
  "residueBefore": [
    "memory/workspace-21a3230e03772a58/.fixture.json.3.1788827359852.93d925094925c8.tmp"
  ],
  "retryValue": "new",
  "residueAfter": [
    "memory/workspace-21a3230e03772a58/.fixture.json.3.1788827359852.93d925094925c8.tmp"
  ],
  "residueSizes": [0]
}
```

## Practical limits

This is a scoped source/diff review and one synthetic probe, not independent repetition of the parent's passing full check/build. No native non-Linux qualification, physical storage faults, process crashes, power-loss durability or hostile same-user racing was tested. The lstat/unlink interval remains a pathname race; dev/ino checks also do not make inode reuse impossible after close. These are limits of the current private-directory design, not newly substantiated regressions in this patch. Failed removal intentionally retains residue and reports cleanup failure; this review does not infer a background retry guarantee for all temporary files.

## Post-correction disposition

**The P3 finding above is resolved for the reproduced transient identity failure; no blocker remains in the scoped memory review.** Original evidence is retained above to distinguish the failure from verification of the correction.

The parent added a bounded descriptor-based identity retry in the catch (`src/kiro/memory.ts:615–618`), before the existing one-attempt close. This retries only when identity is absent and the descriptor has never been submitted to close, so it cannot stat a descriptor reused after an uncertain close. A successful retry identifies the original open file even when its pathname has been replaced. A failed retry is retained as a cleanup error, then close still runs once; no pathname is deleted without verified identity. Successful writes and publication/acknowledgement ordering are unchanged.

Inspected the three new memory metadata cases in `tests/storage-failure.test.ts:117–159` and their `failTemporaryIdentity` helper at line 90. They exercise owned-path cleanup after transient failure, foreign-path replacement while the descriptor remains open, and two failed identity attempts with conservative residue preservation. They assert old committed data, primary/secondary error identity, bounded attempt/close counts, and successful later writes. The shared helper tracks descriptor reuse and removes tracking on close. The persistent-failure test explicitly establishes that uncertainty residue remains after a successful retry; the remedy does not promise eventual cleanup when ownership could never be recorded. I-011 records all six shared memory/MCP metadata cases red before this correction.

Independently reran the exact original probe against corrected source, using this command to execute the retained command verbatim (exit 0):

```sh
python3 - <<'PY'
from pathlib import Path
import subprocess
report = Path('audits/2026-09-08-repository-audit/astra-memory-review.md').read_text()
command = report.split('```sh\n', 1)[1].split('\n```', 1)[0]
raise SystemExit(subprocess.run(['bash', '-c', command], check=False).returncode)
PY
```

```json
{
  "root": "/tmp/astra-memory-review-DDeZXt",
  "errorIsOriginal": true,
  "error": "synthetic one-shot temporary fstat EIO",
  "committed": false,
  "statAttempts": 2,
  "closeAttempts": 1,
  "before": "old",
  "residueBefore": [],
  "retryValue": "new",
  "residueAfter": [],
  "residueSizes": []
}
```

No broad tests or build were repeated by this reviewer; the parent handles targeted/full validation and final build. This follow-up modified only this report and created the disposable probe output under `/tmp`.
