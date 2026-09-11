#!/usr/bin/env node
/** CHECKOUT CACHE GC ONLY. Never visits ~/.kiro, installed runtimes, profiles,
 * backups, sessions, databases, arbitrary .tmp contents, or archives.
 *
 * Usage: node scripts/installer-cache.mjs [--root CHECKOUT] [--apply]
 *          [--keep COUNT] [--max-bytes BYTES]
 * Default is dry-run (a transient coordination gate is the only write).
 * --apply is the ONLY deletion opt-in. --keep defaults to 2 newest validated
 * generations per kind/target, INCLUDING active entries. --max-bytes defaults to
 * 2147483648 and caps retained validated bytes globally, evicting oldest inactive
 * entries first. Active entries always win, even if either budget is exceeded.
 * Unknown/unsafe/modified entries are not budgeted and are NEVER deleted.
 *
 * Eligible paths are direct children of canonical CHECKOUT/.tmp only:
 *   .kiro-fabric-agent-generation-<sha256>
 *   kiro-fabric-bundle-<linux|darwin>-<arm64|x64>-<sha256>
 *   private-tools-<sha256-of-canonical-pins>
 * Each MUST have an intact private .installer-cache-records/<name>.json receipt
 * and independently validated bytes, modes, links, ownership and inventories.
 * The kiro-fabric-agent and complete-bundle.json pointers, their referenced tool
 * pins, and current build-toolchain pins are always preserved. No archive pruning.
 *
 * Every producer/consumer must hold withInstallerArtifactLease through its last
 * use (source frontend: lookup -> pnpm install/build on miss -> activation).
 * Leases are per consumer and nestable. GC holds the same enrollment gate for its
 * entire plan/apply and refuses ANY lease, including malformed/dead/stale leases.
 * There is no negative process scan, timeout-based recovery or evidence cleanup.
 * Interrupted gates/leases require operator inspection, not an --apply bypass.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256, validateBundle, checkToolPins } from "./bundle-contract.mjs";
import { captureBuildInputs } from "./build-inputs.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";
import { verifyPrivateToolCache } from "./build-private-tools.mjs";
import { validateActiveCompleteBundle } from "./build-complete-bundle.mjs";
import { readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";
import { artifactKind, cacheDirectory, exists, readArtifactRecord, CACHE_RECORDS, captureArtifactTree, assertArtifactTreeUnchanged, removeCapturedArtifact, unlinkCapturedFile, cacheFileIdentity, withInstallerCacheGate, assertNoArtifactLeases } from "./installer-artifacts.mjs";
export { withInstallerArtifactLease } from "./installer-artifacts.mjs";

const defaultRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const same = (a, b) => canonical(a) === canonical(b);
function policy(options) {
  const keep = options.keep ?? 2, maxBytes = options.maxBytes ?? 2 * 1024 ** 3;
  if (!Number.isSafeInteger(keep) || keep < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || options.apply !== undefined && typeof options.apply !== "boolean") throw new Error("Cache policies must be nonnegative safe integers; apply must be boolean");
  return { keep, maxBytes, apply: options.apply === true };
}
async function activeArtifacts(root, parent) {
  const names = new Set(), agent = path.join(parent, "kiro-fabric-agent");
  if (exists(agent)) {
    if (!fs.lstatSync(agent).isSymbolicLink()) throw new Error("Uncertain active Agent pointer; preserve cache");
    const validated = validateAgentPackage(agent); names.add(path.basename(validated.root));
  }
  const bundle = await validateActiveCompleteBundle(parent);
  if (bundle) { names.add(path.basename(bundle.root)); names.add(`private-tools-${sha256(canonical(bundle.manifest.tools))}`); }
  // Current pins remain useful even when there is no completed bundle pointer.
  const config = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8"));
  if (!config.targets || typeof config.targets !== "object" || Array.isArray(config.targets) || !Object.keys(config.targets).length) throw new Error("Uncertain checkout toolchain; preserve cache");
  for (const [target, pins] of Object.entries(config.targets)) { checkToolPins(pins, undefined, target); names.add(`private-tools-${sha256(canonical(pins))}`); }
  return [...names].sort();
}
async function validateRecorded(parent, name, record) {
  const directory = path.join(parent, name), captured = await captureArtifactTree(directory);
  let target = "agent";
  if (record.kind === "agent") {
    if (validateAgentPackage(directory).digest !== record.digest) throw new Error("Agent receipt digest mismatch");
  } else if (record.kind === "bundle") {
    const bundle = await validateBundle(directory); target = bundle.manifest.target;
    if (bundle.digest !== record.digest || name !== `kiro-fabric-bundle-${target}-${bundle.digest}`) throw new Error("Bundle receipt digest mismatch");
  } else {
    target = record.identity.target;
    if (sha256(canonical(record.identity.pins)) !== record.digest) throw new Error("Tool receipt pin mismatch");
    await verifyPrivateToolCache(directory, record.identity.pins, target);
  }
  assertArtifactTreeUnchanged(captured);
  return { name, record, captured, bytes: captured.bytes, group: `${record.kind}:${target}`, modified: fs.lstatSync(directory).mtimeMs };
}
/** Opt-in, fail-closed checkout-only collector. Returns its exact plan/evidence. */
export async function collectInstallerCache(options = {}) {
  return collectInstallerCacheForTest(options, {});
}
/** Internal race fixture seam; no hook is selectable from CLI or environment. */
export async function collectInstallerCacheForTest(options, hooks) {
  const rules = policy(options), root = fs.realpathSync(options.root ?? defaultRoot()), parent = cacheDirectory(root);
  const result = { root, dryRun: !rules.apply, policy: { keep: rules.keep, maxBytes: rules.maxBytes }, planned: [], removed: [], preserved: [], retainedBytes: 0, overBudget: false };
  if (!parent) return result;
  // An installed runtime/data home is not a source checkout, even if it has .tmp.
  captureBuildInputs(root);
  if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name !== "kiro-fabric") throw new Error("Cache GC requires a Kiro Fabric source checkout");
  return withInstallerCacheGate(root, async () => {
    assertNoArtifactLeases(parent);
    const active = await activeArtifacts(root, parent), candidates = [];
    for (const name of readDirectoryBoundedSync(parent, 8192).sort()) {
      if (!artifactKind(name)) {
        if (!["kiro-fabric-agent", "complete-bundle.json", CACHE_RECORDS, ".installer-artifact-leases", ".installer-cache-gate"].includes(name)) result.preserved.push({ name, reason: "unknown/unowned path" });
        continue;
      }
      try {
        const record = await readArtifactRecord(parent, name);
        candidates.push(await validateRecorded(parent, name, record));
      } catch (error) { result.preserved.push({ name, reason: `unvalidated: ${error.message}` }); }
    }
    candidates.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    const counts = new Map(), retained = new Set();
    for (const entry of candidates) {
      const count = counts.get(entry.group) ?? 0; counts.set(entry.group, count + 1);
      if (active.includes(entry.name) || count < rules.keep) retained.add(entry.name);
    }
    let retainedBytes = candidates.filter(entry => retained.has(entry.name)).reduce((n, entry) => n + entry.bytes, 0);
    for (const entry of [...candidates].reverse()) if (retainedBytes > rules.maxBytes && retained.has(entry.name) && !active.includes(entry.name)) {
      retained.delete(entry.name); retainedBytes -= entry.bytes;
    }
    for (const entry of candidates) {
      if (retained.has(entry.name)) result.preserved.push({ name: entry.name, reason: active.includes(entry.name) ? "active" : "retention", bytes: entry.bytes });
      else result.planned.push({ name: entry.name, bytes: entry.bytes });
    }
    result.retainedBytes = retainedBytes; result.overBudget = retainedBytes > rules.maxBytes;
    if (!rules.apply) return result;
    await hooks.beforeApply?.();
    // Enrollment remains blocked while the gate is held. A negative process scan
    // can never substitute for this protocol or authorize stale lease removal.
    assertNoArtifactLeases(parent);
    if (!same(await activeArtifacts(root, parent), active)) throw new Error("Active cache pointers changed; no pruning attempted");
    for (const entry of candidates.filter(entry => !retained.has(entry.name))) {
      try {
        const receipt = path.join(parent, CACHE_RECORDS, `${entry.name}.json`), receiptIdentity = cacheFileIdentity(receipt);
        if (!same(await readArtifactRecord(parent, entry.name), entry.record)) throw new Error("Cache ownership receipt changed");
        const second = await validateRecorded(parent, entry.name, entry.record);
        if (!same(second.captured, entry.captured)) throw new Error("Cache bytes or drift boundary changed");
        assertNoArtifactLeases(parent);
        removeCapturedArtifact(second.captured);
        unlinkCapturedFile(receipt, receiptIdentity);
        result.removed.push({ name: entry.name, bytes: entry.bytes });
      } catch (error) {
        result.preserved.push({ name: entry.name, reason: `changed/uncertain during apply: ${error.message}`, bytes: entry.bytes });
        result.retainedBytes += entry.bytes;
      }
    }
    result.overBudget = result.retainedBytes > rules.maxBytes;
    return result;
  });
}
export function parseInstallerCacheArguments(args) {
  const options = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Duplicate cache option: ${flag}`); seen.add(flag);
    if (flag === "--apply") options.apply = true;
    else if (["--keep", "--max-bytes", "--root"].includes(flag)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (flag === "--root") options.root = path.resolve(value);
      else {
        if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid value for ${flag}`);
        options[flag === "--keep" ? "keep" : "maxBytes"] = Number(value);
      }
    } else throw new Error(`Unknown cache option: ${flag}`);
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join() === "--help") console.log("Checkout cache GC (dry-run by default). Usage: installer-cache.mjs [--root CHECKOUT] [--apply] [--keep COUNT=2] [--max-bytes BYTES=2147483648]\nOnly recorded, validated .tmp generations; active/unknown/modified/leased entries are preserved. All consumers must lease through final use. Stale leases/gates require inspection; never reclaimed automatically.");
  else console.log(JSON.stringify(await collectInstallerCache(parseInstallerCacheArguments(process.argv.slice(2))), null, 2));
}
