# Independent Astra review: MCP snapshot staging (F-001)

**Final disposition: the additional identity-failure case below is fixed and independently reverified.** The original reproduction is preserved; see the post-correction disposition at the end.

Result: **the completed-close F-001 path is repaired, and the adjacent initial-identity failure found during review is now corrected**. No remaining blocker was identified. Confidence is high for the inspected and reproduced paths. The pre-correction evidence below is retained. This is a bounded independent source/test review, not a new full repository audit.

## Confirmed adjacent cleanup incompleteness

**MCP-R1 — transient initial fstat failure retains a recoverably owned empty snapshot. Severity: low; confidence: high.** At `src/kiro/mcp-provider.ts:220`, the first `fstatSync` can throw after exclusive creation but before `createdStats` is assigned. The handler at line 234 closes the still-owned descriptor, then skips pathname cleanup at line 235 because identity is absent. A one-time EIO therefore leaves a zero-byte `.kiro-fabric-mcp-snapshot-*` file, although a second identity read while the descriptor is definitely open would succeed. This behavior predates the reviewed close fix; it is additional cleanup incompleteness, not a new regression or configuration-content disclosure.

Recommended narrow correction: if identity is missing and the descriptor is still owned, make one identity retry before attempting close, retaining the primary and any secondary identity/close errors. Then use the existing identity-aware cleanup. Do not infer ownership from pathname alone or retry after uncertain close. `src/providers/owned-file.ts:8` already follows this bounded identity recovery pattern. Successful-path compatibility is unchanged; the correction only improves residue cleanup after initial-stat failure. Parent was notified and owns the implementation.

A focused probe transpiled the actual source helper bodies and injected a first-call-only `fstatSync` EIO. It used a synthetic private empty MCP configuration, no runtime loading or connections. Result (exit 0): `primaryPreserved=true`, `statAttempts=1`, `closeAttempts=1`, `configPreserved=true`, one snapshot with `bytes=0`. The exact command is recorded below.

## Evidence and checked conditions

- `src/kiro/mcp-provider.ts:204`: the staging writer's local close helper clears descriptor ownership before `closeSync`. Both normal completion and the failure handler use that helper. A close that releases its descriptor and then throws cannot trigger a second close, including after numeric descriptor reuse.
- `src/kiro/mcp-provider.ts:232`: pathname cleanup runs independently after a close failure. It compares the captured inode/device and regular-file/link identity before unlinking; a foreign replacement fails the identity check and remains untouched. Successful removal is followed by directory sync.
- `src/kiro/mcp-provider.ts:233`: the primary error remains the thrown object when cleanup succeeds. An additional close, lstat, unlink, or directory-sync error is retained in `AggregateError.errors`, with the original error as `cause`; an already absent pathname is tolerated. The reported removal-failure case deliberately retains residue rather than claiming deletion succeeded.
- `src/kiro/mcp-provider.ts:136`, `src/kiro/mcp-provider.ts:189`, `src/kiro/mcp-provider.ts:550`: the explicit configuration is read and validated, then copied into a distinct exclusive private snapshot. The change introduces no writes to the explicit configuration. Digest/identity verification before and after definition loading and exact configured-server/source checks remain in place.
- `src/kiro/mcp-provider.ts:250`, `src/kiro/mcp-provider.ts:553`: successfully staged snapshots still pass through the existing loading `finally` cleanup. Staging failures occur before entering that block and are cleaned by the corrected staging handler, so the two cleanup owners do not overlap for F-001.
- `src/kiro/mcp-provider.ts:630`, `src/kiro/mcp-provider.ts:935`: `$servers` awaits lazy runtime creation. A rejected creation never populates `#runtime`, and its settled creation promise is cleared, permitting another invocation to create a runtime. Provider shutdown remains terminal and handles pending creation separately (`src/kiro/mcp-provider.ts:730`).
- `tests/storage-failure.test.ts:37`, `tests/storage-failure.test.ts:66`, `tests/storage-failure.test.ts:94`: all four new parameterized cases exercise MCP through a real provider with a synthetic empty, imports-disabled configuration. They verify one close attempt, original error identity, primary/secondary error ordering, owned residue removal or reported failed removal, explicit configuration preservation, and foreign replacement preservation. The first two cases retry on the same provider after restoring filesystem operations. The mock tracks subsequent opens so descriptor-number reuse for directory sync does not produce a false duplicate-close result.
- `tests/mcp-federation.test.ts:310`: existing real-loader/stdio coverage checks explicit configuration loading and absence of leftover snapshots. Adjacent cases at lines 351, 367, 380, 395 and 408 cover aliased configuration, disabled imports, post-load drift, ambient behavior switches and cancellation during creation. The available repository names this coverage `mcp-federation.test.ts`; there are no separate `mcp-loading.test.ts` or `mcp-provider.test.ts` files.
- The corrected aggregate-error marker is present in generated `dist/index.js` and `dist/kiro-agent-closure/chunks/mcp-server-5B4J7MAC.js`.

## Compatibility and limits

Successful loading, public inputs, explicit configuration format, snapshot permissions and server-selection behavior remain unchanged. The intended observable difference is better cleanup and diagnostics on storage failure: combined staging/cleanup failures now expose an `AggregateError`, while a primary error with successful cleanup is preserved directly.

No broad tests were rerun. The previously recorded 885-test full check and subsequent fresh build are existing parent-task evidence, not independently rerun results. This review does not claim universal storage-fault recovery, atomic pathname identity checks against arbitrary concurrent filesystem mutation, or live MCP/OAuth qualification. Repository source, tests, configuration and generated output were read-only; only this report and the disposable synthetic fixture under `/tmp` were written. No credentials or external services were accessed. The parent handles final build requirements.

## Exact focused probe

Run from `/home/adam/projects/kiro-fabric`:

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import ts from 'typescript';
const source = fs.readFileSync('src/kiro/mcp-provider.ts', 'utf8');
const fragment = 'const MAX_EXPLICIT_MCP_CONFIG_BYTES = 256 * 1024;\n' + source.slice(source.indexOf('const sameFileIdentity ='), source.indexOf('const AMBIENT_MCPORTER_OPTIONS ='));
const compiled = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const { read, stage } = new Function('fs', 'path', 'randomBytes', 'createHash', 'isRecord', compiled + '\nreturn {read:readExplicitMcpConfiguration,stage:stageExplicitMcpConfiguration};')(fs, path, randomBytes, createHash, value => value !== null && typeof value === 'object' && !Array.isArray(value));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-mcp-initial-stat-'));
const config = path.join(root, 'mcp.json');
const bytes = '{"imports":[],"mcpServers":{}}';
fs.writeFileSync(config, bytes, {mode:0o600});
const explicit = read(config);
const originalStat = fs.fstatSync;
const originalClose = fs.closeSync;
const failure = Object.assign(new Error('initial fstat EIO'), {code:'EIO'});
let statAttempts = 0, closeAttempts = 0;
fs.fstatSync = function(...args) { statAttempts++; if(statAttempts === 1) throw failure; return originalStat.apply(this,args); };
fs.closeSync = function(...args) { closeAttempts++; return originalClose.apply(this,args); };
let caught;
try { stage(config, explicit); } catch(error) { caught = error; }
finally { fs.fstatSync = originalStat; fs.closeSync = originalClose; }
const residues = fs.readdirSync(root).filter(name => name.startsWith('.kiro-fabric-mcp-snapshot-')).map(name => ({name,bytes:fs.statSync(path.join(root,name)).size}));
console.log(JSON.stringify({primaryPreserved:caught===failure,statAttempts,closeAttempts,configPreserved:fs.readFileSync(config,'utf8')===bytes,residues}));
fs.rmSync(root,{recursive:true,force:true});
NODE
```

Output:

```json
{"primaryPreserved":true,"statAttempts":1,"closeAttempts":1,"configPreserved":true,"residues":[{"name":".kiro-fabric-mcp-snapshot-3-be3b8de1381aeebccea4d166d640f69b.json","bytes":0}]}
```

## Post-correction disposition

**MCP-R1 resolved in the reviewed source.** `src/kiro/mcp-provider.ts:234` now retries identity once only when `createdStats` is absent and the descriptor remains definitely owned. The retry precedes close; completed/uncertain close cannot reach this retry with descriptor ownership retained. Successful recovery feeds the existing identity check and cleanup. Persistent recovery failure is aggregated with the original cause, the descriptor is closed once, and unverified residue is preserved.

Inspected the three new MCP metadata cases at `tests/storage-failure.test.ts:126` and the injection helper at line 90: transient identity recovery with owned pathname; transient recovery after a foreign replacement; persistent identity failure. They assert two metadata attempts, one temporary-descriptor close, original/secondary error preservation, appropriate residue and configuration preservation, and later operation on the same provider. The foreign case recovers identity from the original open inode, rather than the replacement pathname, and verifies that replacement survives.

An independent repeat of the focused synthetic source-helper probe after correction exited 0 with `primaryPreserved=true`, `statAttempts=2`, `closeAttempts=2`, `configPreserved=true`, `residues=[]`. This probe counts *all* closes: one temporary descriptor plus one newly opened directory descriptor for the successful removal sync. The focused regression helper counts only the temporary close and asserts one. No broad tests were rerun; parent owns I-012/full-check/build evidence.

Exact post-correction command:

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import ts from 'typescript';
const source=fs.readFileSync('src/kiro/mcp-provider.ts','utf8');
const fragment='const MAX_EXPLICIT_MCP_CONFIG_BYTES = 256 * 1024;\n'+source.slice(source.indexOf('const sameFileIdentity ='),source.indexOf('const AMBIENT_MCPORTER_OPTIONS ='));
const compiled=ts.transpileModule(fragment,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const {read,stage}=new Function('fs','path','randomBytes','createHash','isRecord',compiled+'\nreturn {read:readExplicitMcpConfiguration,stage:stageExplicitMcpConfiguration};')(fs,path,randomBytes,createHash,v=>v!==null&&typeof v==='object'&&!Array.isArray(v));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'astra-mcp-fixed-stat-'));
const config=path.join(root,'mcp.json'),bytes='{"imports":[],"mcpServers":{}}';
fs.writeFileSync(config,bytes,{mode:0o600});
const explicit=read(config),stat=fs.fstatSync,close=fs.closeSync,failure=Object.assign(new Error('initial fstat EIO'),{code:'EIO'});
let statAttempts=0,closeAttempts=0,caught;
fs.fstatSync=function(...args){if(++statAttempts===1)throw failure;return stat.apply(this,args)};
fs.closeSync=function(...args){closeAttempts++;return close.apply(this,args)};
try{stage(config,explicit)}catch(error){caught=error}finally{fs.fstatSync=stat;fs.closeSync=close}
console.log(JSON.stringify({primaryPreserved:caught===failure,statAttempts,closeAttempts,configPreserved:fs.readFileSync(config,'utf8')===bytes,residues:fs.readdirSync(root).filter(n=>n.startsWith('.kiro-fabric-mcp-snapshot-'))}));
fs.rmSync(root,{recursive:true,force:true});
NODE
```

Output:

```json
{"primaryPreserved":true,"statAttempts":2,"closeAttempts":2,"configPreserved":true,"residues":[]}
```
