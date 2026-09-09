#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createPlan, executable, budgetGate } from './steering-benchmark/plan.mjs';
import { init, runOne, summary, loadPlan, rows, privateOutput } from './steering-benchmark/runner.mjs';
import { selftest } from './steering-benchmark/selftest.mjs';
import { errorText } from './steering-benchmark/core.mjs';

export const usage = `node scripts/steering-benchmark.mjs plan --manifest /private/manifest.json
node scripts/steering-benchmark.mjs init --manifest /private/manifest.json --out /private/new-output
node scripts/steering-benchmark.mjs run --out /private/new-output [--index 0] [--count 1]
node scripts/steering-benchmark.mjs summary --out /private/new-output
node scripts/steering-benchmark.mjs selftest [--python python3] [--out /private/new-selftest]
Manifest JSON: {cli,python,runtimePaths:[CLI runtime artifact paths],cliConfigPaths:[CLI config files],
 arms:{old:{profile,runtimePaths:[complete bundle root],configPaths:[private config files]},pass1:{...},pass2:{...}},
 nativeMode:"vibe",nativeWorkspacePermissions:true,nativeTrustTools:["fs_read","fs_write","str_replace","execute_bash","shell"],model:"auto",cases:["read24","bug-money"],snapshotCliSettings:true,repetitions:2,seed:"steering-v1",plannedCredits:20,creditCeiling:40,priorCredits:0,reserveCredits:5,
 maxCalls:40,timeoutMs:150000,maxOutputBytes:8388608,env:{}}
All identity paths are required, relative paths resolve against the manifest directory; CLI/Python names resolve on PATH.
Fabric arms may be any subset of old/pass1/pass2/fabric; native is always included. Optional cases selects from the legacy 13 contracts plus nine TinyShop bug cases; omission preserves the legacy schedule. model defaults to auto. Set priorCredits to account for earlier conversation spend.
Each standalone Fabric profile must bind one complete bundle and a separate preinitialized private data/config root.
plan/init do no inference (init probes --version). snapshotCliSettings:true also revalidates the bounded read-only CLI settings projection before/after each run; otherwise cliSettings:null explicitly leaves that check unavailable. run is opt-in paid work, sequential, no retries or trust-all-tools.
run defaults to one attempt; --count is bounded by the remaining plan. Native uses no --agent. nativeTrustTools explicitly selects benign fixture tools; current v3 uses separate tool and capability gates: include str_replace, execute_bash and shell as well as fs_read/fs_write. Omission preserves the older fs_read,fs_write,shell allowlist. nativeWorkspacePermissions:true separately creates a temporary HOME/.kiro/workspace-roots/<workspace-hash>/permissions.json for Node/fixture-Python/cd commands, verifies it and removes it after the trial. It never overwrites existing policy or changes global rules; interrupted runs retain the exact policy path in their durable row for manual inspection.
Long-line output stress runs last across all repetitions so it cannot preempt the broad coding matrix. The prose case requests an exact supplied sentence, not free-form semantic grading. Rename explicitly preserves all other source bytes.
No OS isolation or network blocking is claimed. Audit files are tamperable evidence, not protected execution logs.`;

/** @param {string[]} argv */
export async function main(argv) {
  const [action, ...rest] = argv; if (!action || action === '--help') return { usage };
  const allowed = { plan: ['manifest'], init: ['manifest', 'out'], run: ['out', 'index', 'count'], summary: ['out'], selftest: ['out', 'python'] };
  assert.ok(action in allowed, usage);
  /** @type {Record<string,string>} */ const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, ''); assert.ok(rest[i].startsWith('--') && allowed[action].includes(key) && rest[i + 1] && !(key in args), 'invalid/duplicate option: ' + rest[i]); args[key] = rest[i + 1];
  }
  if (action === 'selftest') return await selftest({ output: args.out, python: executable(args.python ?? 'python3') });
  if (action === 'plan' || action === 'init') { assert.ok(args.manifest, '--manifest required'); return action === 'plan' ? createPlan(args.manifest) : await init(args.manifest, args.out || assert.fail('--out required')); }
  assert.ok(args.out, '--out required');
  if (action === 'summary') return summary(args.out);
  const count = args.count === undefined ? 1 : Number(args.count), index = args.index === undefined ? undefined : Number(args.index);
  assert.ok(Number.isInteger(count) && count > 0 && count <= 1020 && (index === undefined || Number.isInteger(index) && index >= 0), 'invalid run count/index');
  const controller = new AbortController(), abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const executed = [];
  try {
    for (let i = 0; i < count; i++) {
      if (controller.signal.aborted) break;
      const row = await runOne(args.out, index === undefined ? undefined : index + i, controller.signal); executed.push(row);
      if (row.stopReason) break;
      const plan = loadPlan(args.out), previous = rows(privateOutput(args.out)); if (previous.length === plan.runs.length) break;
      try { budgetGate(plan.config, previous, plan.runs.length); } catch (error) { return { executed, stopped: errorText(error) }; }
    }
    return { executed, canceled: controller.signal.aborted };
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: errorText(error) })); process.exitCode = 1; }
}
