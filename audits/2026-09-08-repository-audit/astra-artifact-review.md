# Independent Astra review: artifact deletion (F-002)

## Conclusion

No concrete regression or incomplete correction to F-002 was found. Confidence is high for the synchronous store bookkeeping and the exercised failure/recovery cases. The smallest correct remedy is already present: `src/kiro/artifacts.ts:128` removes the disk file before lines 129–130 release its entry and quota. No additional source change is recommended by this focused review.

Reviewed the entire current `src/kiro/artifacts.ts`, its diff, all artifact cases in `tests/storage-failure.test.ts` and `tests/artifacts-state.test.ts`, and relevant runtime, provider, projection, MCP lifecycle, process shutdown and configuration paths. Source/tests/configuration/build outputs were read only. The parent's previously reported full check and fresh build were not repeated or independently claimed as this review's execution.

## Evidence and caller behavior

- **Repeated failure:** `artifacts.ts:124–130` leaves both map entry and character count intact when `rmSync` throws. Each subsequent eviction, sweep or close retries that entry; no new write can silently consume its unreleased quota.
- **Expired reads:** `artifacts.ts:104` sweeps before fetching content. Persistent deletion failure throws; successful recovery removes the expired entry and returns the unavailable/expired error. Neither path serves expired content. Count and character evictions both use the same removal helper (`:73–75`, `:116–117`).
- **Partial cleanup:** `artifacts.ts:134–135` sets closed only after every removal succeeds. Earlier successful removals release accounting once, while the failing entry and subsequent entries remain owned. A focused synthetic probe confirmed this with three artifacts and a middle-entry failure, then filled the one released quota slot and closed successfully.
- **Other stores:** removal targets only the current store's owned map entry. Existing regression cases retain and read a second live store's file in the same root. Construction does not import fresh existing artifacts (`artifacts.ts:53–64`). The reorder does not broaden deletion targets.
- **Runtime retry:** `runtime.ts:75–77` runs `artifacts.close()` in a finally block on every runtime close call. The cached service close in `execution-service.ts:377–383` does not prevent a later artifact cleanup retry.
- **Workspace switching:** `mcp-server.ts:234–245` retains the runtime reference if close rejects, clearing it only after success. A subsequent identity-changing attempt can retry cleanup; it does not silently abandon failed artifact ownership.
- **User-visible overflow:** `projection.ts:126–147` catches failed artifact retention and emits the existing bounded fallback message. Retention failure caused by a still-accounted failed eviction is truthful and does not announce a nonexistent artifact.
- **Top-level shutdown limit:** `mcp-server.ts:559–570` caches the complete close promise, including rejection. Repeating this outer API does not retry cleanup. `mcp-entry.ts:86–91` logs failed shutdown and exits with status 1. This predates the fix and does not falsely report successful cleanup; this review does not claim automatic recovery during process termination.

The added four regression cases cover persistent expiry/read, count, size and close failures, followed by restored removal through close. The probes below additionally cover recovery through the same operation and multi-entry partial close. They are supplementary review evidence, not committed tests.

## Exact focused probe

Executed from `/home/adam/projects/kiro-fabric`, exit code **0**. All filesystem writes were confined to an owned temporary directory and removed in `finally`. This uses Node's local TypeScript support and no dependencies, credentials or network.

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createKiroArtifactStore } from './src/kiro/artifacts.ts';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-artifact-review-'));
const original = fs.rmSync;
const checks = [];
try {
  for (const mode of ['sweep', 'read', 'count', 'size', 'close']) {
    let now = 1000;
    const folder = path.join(root, mode);
    const store = createKiroArtifactStore({root:folder, now:()=>now, ttlMs:100, maxArtifacts: mode === 'count' ? 1 : 4, maxTotalChars:6});
    const id = store.write('old');
    if (mode === 'sweep' || mode === 'read') now += 101;
    const operation = () => mode === 'sweep' ? store.sweep() : mode === 'read' ? store.read(id) : mode === 'close' ? store.close() : store.write(mode === 'size' ? 'next' : 'new');
    const failure = new Error('injected removal failure');
    fs.rmSync = (file, options) => { if (String(file) === path.join(folder,id)) throw failure; return original(file, options); };
    assert.throws(operation, e=>e===failure); assert.throws(operation, e=>e===failure);
    fs.rmSync = original;
    if (mode === 'read') assert.throws(operation, /unavailable or expired/); else operation();
    assert.equal(fs.existsSync(path.join(folder,id)), false);
    store.close(); assert.deepEqual(fs.readdirSync(folder), []);
    checks.push(mode+': repeated failure and same-operation recovery passed');
  }
  const folder = path.join(root,'partial'); let now = 1000;
  const store = createKiroArtifactStore({root:folder,now:()=>now,maxArtifacts:3,maxTotalChars:9});
  const first = store.write('aaa'); now++;
  const second = store.write('bbb'); now++;
  const third = store.write('ccc');
  const failure = new Error('middle removal failed');
  fs.rmSync = (file,options) => {if(String(file)===path.join(folder,second))throw failure; return original(file,options);};
  assert.throws(()=>store.close(),e=>e===failure);
  assert.equal(fs.existsSync(path.join(folder,first)),false);
  assert.equal(fs.existsSync(path.join(folder,second)),true);
  assert.equal(fs.existsSync(path.join(folder,third)),true);
  fs.rmSync=original;
  const fourth = store.write('ddd');
  assert.equal(store.read(second).text,'bbb');
  assert.equal(store.read(third).text,'ccc');
  assert.equal(store.read(fourth).text,'ddd');
  store.close();assert.deepEqual(fs.readdirSync(folder),[]);
  checks.push('partial close: successful removals release quota once; failed and later entries remain owned; retry passed');
  console.log(JSON.stringify({checks},null,2));
} finally {fs.rmSync=original;original(root,{recursive:true,force:true});}
NODE
```

Output:

```json
{
  "checks": [
    "sweep: repeated failure and same-operation recovery passed",
    "read: repeated failure and same-operation recovery passed",
    "count: repeated failure and same-operation recovery passed",
    "size: repeated failure and same-operation recovery passed",
    "close: repeated failure and same-operation recovery passed",
    "partial close: successful removals release quota once; failed and later entries remain owned; retry passed"
  ]
}
```

## Boundaries

This does not establish crash durability, secure erasure, native Windows/macOS behavior, adversarial same-user pathname replacement safety, or global disk quotas across stores. The existing failed-write-plus-failed-cleanup path (`artifacts.ts:89–95`) reports an aggregate failure before publication and is separate from F-002's removal of registered entries; the change is not a general pending-residue cleanup subsystem. No real client or process-shutdown integration fault injection was performed. Existing finite-shutdown and constructor residue policies were traced, not redesigned.
