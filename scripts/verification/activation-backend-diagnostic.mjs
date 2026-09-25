// Activation-only fault seam. This does not replace smokeCandidate or execute a
// forged/unpinned bundle: real private-tool checks and the real backend run first.
// Corrupt ONLY the observed tools/list reply of that exact candidate backend,
// after observing its successful initialization and genuine expected inventory.
// The asserted failure is production smoke's actual inventory diagnostic.
import assert from 'node:assert/strict';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { smokeCandidate } from '../installer-smoke.mjs';
export async function smokeWithBackendInventoryFault(bundleRoot) {
  const originalSpawn = childProcess.spawn;
  const evidence = { backendSpawned: false, initialized: false, genuineInventory: false, faultInjected: false, closed: false, code: null, signal: null, detachedNavigatorForcedSettlement: 'unqualified' };
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  let originalEmit;
  // Forward every original overload unchanged; intercept only this backend.
  childProcess.spawn = /** @type {typeof originalSpawn} */ (function(command, args, options) {
    const spawned = originalSpawn(command, args, options);
    if (command !== path.join(bundleRoot, 'tools/node') || args?.length !== 1 || args[0] !== path.join(bundleRoot, 'app/kiro/mcp-entry.js')) return spawned;
    if (child) throw Error('diagnostic seam encountered multiple backend spawns');
    child = spawned; evidence.backendSpawned = true;
    originalEmit = child.stdout.emit;
    let pending = '';
    child.stdout.emit = function(event, ...values) {
      if (event !== 'data') return originalEmit.call(this, event, ...values);
      pending += String(values[0]);
      if (pending.length > 1024 * 1024) { const chunk = pending; pending = ''; return originalEmit.call(this, event, chunk); }
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        let line = pending.slice(0, end); pending = pending.slice(end + 1);
        let frame; try { frame = JSON.parse(line); } catch { /* production diagnoses malformed JSON */ }
        if (frame?.id === 1 && !frame.method && !frame.error && frame.result && typeof frame.result === 'object') evidence.initialized = true;
        if (frame?.id === 2 && !frame.method && evidence.initialized && !frame.error && !frame.result?.isError && JSON.stringify(frame.result?.tools?.map(t => t.name).sort()) === JSON.stringify(['fabric_exec', 'fabric_info', 'fabric_workspace'])) {
          evidence.genuineInventory = true; evidence.faultInjected = true;
          line = JSON.stringify({ ...frame, result: { ...frame.result, tools: [] } });
        }
        originalEmit.call(this, event, line + '\n');
      }
      return true;
    };
    child.once('close', (code, signal) => { evidence.closed = true; evidence.code = code; evidence.signal = signal; });
    return spawned;
  });
  syncBuiltinESMExports();
  let failure;
  try { await smokeCandidate(bundleRoot); } catch (error) { failure = error; }
  finally {
    childProcess.spawn = originalSpawn; syncBuiltinESMExports();
    if (child && originalEmit) child.stdout.emit = originalEmit;
  }
  assert.ok(failure, 'real production smoke must refuse the injected backend response');
  assert.equal(failure.message, 'Candidate raw backend inventory mismatch', 'earlier trust/version/admission failures are NOT backend diagnostic evidence');
  for (const field of ['backendSpawned', 'initialized', 'genuineInventory', 'faultInjected', 'closed']) assert.equal(evidence[field], true, 'missing backend fault evidence: ' + field);
  // The seam deliberately never reaches Navigator. No detached-engine settlement
  // or successful backend smoke is claimed by this diagnostic-only receipt.
  throw Object.assign(failure, { activationBackendDiagnostic: evidence });
}
