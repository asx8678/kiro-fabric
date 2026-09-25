// Small maintained oracle controls only. No staging/loader/activation imports,
// child processes, repositories, network, cleanup, or deletion. All fixtures stay.
// Run: node scripts/verification/staging-preservation-probe.mjs <owned-output-dir>
// Each invocation creates a fresh staging-final-* directory and exclusive JSON.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { snapshotStagingScope as snap, assertStagingScopeUnchanged as unchanged, assertStagingCallPreserved as preserved } from "./staging-preservation-snapshot.mjs";

if (!process.argv[2]) throw new Error("Pass an existing task-owned output directory; all fixtures will be retained");
const output = fs.realpathSync(path.resolve(process.argv[2]));
const root = fs.mkdtempSync(path.join(output, "staging-final-probe-"));
fs.chmodSync(root, 0o700);
const results = [];
const dir = name => { const p = path.join(root, name); fs.mkdirSync(p, { mode: 0o700 }); return p; };
/** @param {string} p @param {string | Uint8Array} [body] */
const write = (p, body = "abc") => fs.writeFileSync(p, body, { flag: "wx", mode: 0o600 });
const check = (name, action) => { const evidence = action(); results.push({ name, passed: true, ...evidence }); };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const patch = (name, replacement, action) => {
  const original = fs[name]; fs[name] = replacement(original);
  try { return action(); } finally { fs[name] = original; }
};
const scoped = name => {
  const parent = dir(name), child = path.join(parent, "I07-staging");
  fs.mkdirSync(child, { mode: 0o700 }); write(path.join(child, "file"));
  return { parent, child, snapshot: () => snap(child, { boundaryRoot: parent, inventoryParent: true }) };
};

try {
  check("unchanged-full-bytes-and-read-induced-atime", () => {
    const f = scoped("unchanged"), before = f.snapshot();
    assert.equal(before.entries.find(e => e.path === "file").sha256, sha("abc"));
    assert.equal(before.bytes, 3);
    fs.readFileSync(path.join(f.child, "file"));
    const after = f.snapshot(); unchanged(before, after, "unchanged"); preserved(before, after, "unchanged");
    assert.ok(before.entries.every(e => /^\d+$/.test(e.mtimeNs) && /^\d+$/.test(e.ctimeNs) && !Object.hasOwn(e, "atimeNs")));
    return { bytes: 3, parentInventoried: true, timestampFields: ["mtimeNs", "ctimeNs"] };
  });
  check("actual-allowed-output-and-nested-additions", () => {
    const f = scoped("allowed"), before = f.snapshot();
    const out = path.join(f.child, "out"); fs.mkdirSync(out, { mode: 0o700 }); write(path.join(out, "member"));
    preserved(before, f.snapshot(), "actual output", { allowedAddedPrefixes: ["out"] });
    const nestedBefore = f.snapshot(); write(path.join(out, "second"));
    preserved(nestedBefore, f.snapshot(), "nested output", { allowedAddedPrefixes: ["out"] });
    const fakeAncestorChange = f.snapshot(); fakeAncestorChange.entries.find(e => e.path === ".").mtimeNs += "1";
    assert.throws(() => preserved(nestedBefore, fakeAncestorChange, "unaffected ancestor", { allowedAddedPrefixes: ["out"] }), /\. mtimeNs changed/);
    return { actualOutputAccepted: true, onlyDirectParentExempt: true };
  });
  check("explicit-drift-only-exact-fields", () => {
    const f = scoped("drift"), before = f.snapshot(), file = path.join(f.child, "file");
    fs.writeFileSync(file, "xyz");
    const after = f.snapshot(), options = { allowedChanged: [{ path: "file", fields: ["sha256", "mtimeNs", "ctimeNs"] }] };
    preserved(before, after, "intentional", options);
    assert.throws(() => preserved(before, after, "hash not permitted", { allowedChanged: [{ path: "file", fields: ["mtimeNs", "ctimeNs"] }] }), /sha256 changed/);
    fs.chmodSync(file, 0o640);
    assert.throws(() => preserved(before, f.snapshot(), "unintended mode", options), /mode changed/);
    return { exactDriftAccepted: true, extraModeRejected: true };
  });
  check("same-size-rename-between-lstat-and-open", () => {
    const parent = dir("rename"), file = path.join(parent, "file"); write(file, "old");
    let swapped = false, reads = 0;
    patch("readSync", original => (...args) => { reads++; return original(...args); }, () =>
      patch("openSync", original => (p, ...args) => {
        if (p === file && !swapped) { swapped = true; fs.renameSync(file, path.join(parent, "original-retained")); write(file, "new"); }
        return original(p, ...args);
      }, () => assert.throws(() => snap(file), /changed during snapshot/)));
    assert.equal(swapped, true); assert.equal(reads, 0);
    assert.equal(fs.readFileSync(path.join(parent, "original-retained"), "utf8"), "old");
    return { swapped, reads, originalRetained: true };
  });
  for (const afterEOF of [false, true]) check(afterEOF ? "append-after-EOF-probe-post-stat" : "append-after-data-read-EOF-check", () => {
    const file = path.join(root, afterEOF ? "grow-after-eof" : "grow-after-read"); write(file);
    let grew = false;
    patch("readSync", original => (...args) => {
      const n = original(...args);
      if (!grew && (afterEOF ? n === 0 : n > 0)) { grew = true; fs.appendFileSync(file, "d"); }
      return n;
    }, () => assert.throws(() => snap(file), /grew during snapshot|changed during snapshot/));
    assert.equal(grew, true); assert.equal(fs.statSync(file).size, 4);
    return { grew, rejected: true };
  });
  check("post-read-name-replacement", () => {
    const parent = dir("post-read-name"), file = path.join(parent, "file"); write(file);
    let swapped = false;
    patch("readSync", original => (...args) => {
      const n = original(...args);
      if (!swapped && n === 0) { swapped = true; fs.renameSync(file, path.join(parent, "retained")); write(file); }
      return n;
    }, () => assert.throws(() => snap(file), /changed during snapshot/));
    assert.equal(swapped, true); return { rejected: true, originalRetained: true };
  });
  check("hardlink-rejected-before-content-read", () => {
    const parent = dir("hardlink"), file = path.join(parent, "file"); write(file); fs.linkSync(file, path.join(parent, "second"));
    let reads = 0;
    patch("readSync", original => (...args) => { reads++; return original(...args); }, () => assert.throws(() => snap(file), /single link/));
    assert.equal(reads, 0); return { nlink: fs.statSync(file).nlink, reads };
  });
  check("nofollow-nonblocking-descriptor-flags", () => {
    const file = path.join(root, "flags"); write(file); let files = 0, directories = 0;
    patch("openSync", original => (p, flags, ...rest) => {
      assert.equal(flags & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
      assert.equal(flags & fs.constants.O_NONBLOCK, fs.constants.O_NONBLOCK);
      if (p === file) files++; else { directories++; assert.ok(flags & fs.constants.O_DIRECTORY); }
      return original(p, flags, ...rest);
    }, () => snap(file));
    assert.equal(files, 1); assert.equal(directories, 1);
    return { files, directories, flagsAsserted: true, fifoRaceExecuted: false };
  });
  check("symlink-parent-rejected-leaf-recorded-not-followed", () => {
    const parent = dir("alias"), target = path.join(parent, "target"), alias = path.join(parent, "alias");
    fs.mkdirSync(target, { mode: 0o700 }); write(path.join(target, "file")); fs.symlinkSync(target, alias, "dir");
    assert.throws(() => snap(path.join(alias, "file"), { boundaryRoot: parent }), /noncanonical directory ancestry/);
    assert.throws(() => snap(path.join(alias, "file")), /noncanonical directory ancestry/);
    const leaf = snap(alias); assert.equal(leaf.entries.length, 1); assert.equal(leaf.entries[0].linkTarget, target); assert.equal(leaf.bytes, 0);
    const dangling = path.join(parent, "dangling"), absent = snap(dangling); fs.symlinkSync("absent-target", dangling);
    const added = snap(dangling); assert.equal(added.entries[0].linkTarget, "absent-target");
    assert.throws(() => unchanged(absent, added, "dangling"), /existence changed/);
    return { aliasParentRejected: true, leafBytes: 0, danglingRecorded: true };
  });
  check("directory-swap-at-enumeration-rejected-before-child-read", () => {
    const parent = dir("directory-swap"), child = path.join(parent, "child"); fs.mkdirSync(child, { mode: 0o700 }); write(path.join(child, "file"));
    let swapped = false, reads = 0;
    patch("readSync", original => (...args) => { reads++; return original(...args); }, () =>
      patch("opendirSync", original => (p, ...args) => {
        if (p === child && !swapped) { swapped = true; fs.renameSync(child, path.join(parent, "retained")); fs.mkdirSync(child, { mode: 0o700 }); write(path.join(child, "new")); }
        return original(p, ...args);
      }, () => assert.throws(() => snap(child), /changed during snapshot/)));
    assert.equal(swapped, true); assert.equal(reads, 0); return { swapped, reads };
  });
  check("mtime-file-directory-and-nanosecond-decisions", () => {
    const f = scoped("times"), before = f.snapshot(); fs.utimesSync(path.join(f.child, "file"), 1000000000, 1000000000);
    assert.throws(() => unchanged(before, f.snapshot(), "file time"), /mtimeNs changed|ctimeNs changed/);
    const next = f.snapshot(); fs.utimesSync(f.child, 1000000001, 1000000001);
    assert.throws(() => preserved(next, f.snapshot(), "directory time"), /mtimeNs changed|ctimeNs changed/);
    for (const field of ["mtimeNs", "ctimeNs"]) {
      const altered = structuredClone(next), entry = altered.entries.find(e => e.path === "file"); entry[field] = String(BigInt(entry[field]) + 1n);
      assert.throws(() => preserved(next, altered, "one ns"), new RegExp(field + " changed"));
    }
    return { actualFileAndDirectoryTimeRejected: true, oneNsDecisionChecks: ["mtimeNs", "ctimeNs"] };
  });
  check("zero-addition-root-no-unconditional-exemption", () => {
    const f = scoped("zero-additions"), before = f.snapshot();
    for (const field of ["nlink", "size", "mtimeNs", "ctimeNs"]) {
      const altered = structuredClone(before), entry = altered.entries.find(e => e.path === ".");
      entry[field] = field === "nlink" ? entry.nlink + 1 : String(BigInt(entry[field]) + 1n);
      for (const options of [{}, { allowedAddedPrefixes: ["never-created"] }]) assert.throws(() => preserved(before, altered, "no additions", options), new RegExp(field + " changed"));
    }
    fs.utimesSync(f.child, 1000000000, 1000000000);
    assert.throws(() => preserved(before, f.snapshot(), "actual zero-addition change", { allowedAddedPrefixes: ["never-created"] }), /mtimeNs changed|ctimeNs changed/);
    return { changedFieldsRejected: ["nlink", "size", "mtimeNs", "ctimeNs"], actualRootTimeRejected: true };
  });
  for (const kind of ["parent-mode", "parent-sibling", "outside-child", "inside-sibling"]) check(kind + "-rejected", () => {
    const f = scoped(kind), outside = path.join(f.parent, "other-fixture"); fs.mkdirSync(outside, { mode: 0o700 });
    const before = f.snapshot();
    if (kind === "parent-mode") fs.chmodSync(f.parent, 0o750);
    else if (kind === "parent-sibling") write(path.join(f.parent, "unexpected"));
    else if (kind === "outside-child") write(path.join(outside, "unexpected"));
    else write(path.join(f.child, "unexpected"));
    assert.throws(() => preserved(before, f.snapshot(), kind, { allowedAddedPrefixes: ["out"] }), /mode changed|unexpected path appeared|size changed|mtimeNs changed|ctimeNs changed|nlink changed/);
    return { rejected: true };
  });
  check("parent-inventory-shallow-and-shared-budget", () => {
    const f = scoped("shallow"), sibling = path.join(f.parent, "other-fixture"); fs.mkdirSync(sibling, { mode: 0o700 }); write(path.join(sibling, "do-not-read"));
    const topFile = path.join(f.parent, "shallow-file"); write(topFile, Buffer.alloc(129));
    const visited = [];
    patch("opendirSync", original => (p, ...args) => { visited.push(p); assert.notEqual(p, sibling); return original(p, ...args); }, () => {
      const snapshot = snap(f.child, { boundaryRoot: f.parent, inventoryParent: true, maxBytes: 3 });
      assert.equal(snapshot.bytes, 3); assert.equal(snapshot.parent.entries.find(e => e.path === "shallow-file").sha256, null);
    });
    assert.deepEqual(visited.sort(), [f.parent, f.child].sort());
    assert.throws(() => snap(f.child, { boundaryRoot: f.parent, inventoryParent: true, maxEntries: 2 }), /entry budget exceeded/);
    return { enumeratedOnlyParentAndChild: true, siblingBytesNotRead: true, sharedBudgetRejected: true };
  });
  check("before-read-byte-bound-and-streamed-entry-depth-bounds", () => {
    const large = path.join(root, "large"); write(large, Buffer.alloc(129)); let reads = 0;
    patch("readSync", original => (...args) => { reads++; return original(...args); }, () => assert.throws(() => snap(large, { maxBytes: 128 }), /byte budget exceeded/));
    assert.equal(reads, 0);
    const many = dir("many"); for (let i = 0; i < 12; i++) write(path.join(many, String(i)), "");
    let enumerated = 0;
    patch("opendirSync", original => (...args) => {
      const handle = original(...args), read = handle.readSync.bind(handle);
      handle.readSync = () => { const entry = read(); if (entry) enumerated++; return entry; }; return handle;
    }, () => assert.throws(() => snap(many, { maxEntries: 2 }), /entry budget exceeded/));
    assert.equal(enumerated, 2);
    assert.throws(() => snap(many, { maxDepth: 1 }), /depth budget exceeded/);
    return { overBudgetReads: reads, enumerated, availableNames: 12, depthRejected: true };
  });
  check("public-symbols-I07-wiring-and-unmodified-production-loader", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const installer = fs.readFileSync(path.join(here, "installer-cases.mjs"), "utf8");
    const i07 = installer.slice(installer.indexOf('id: "I07"'), installer.indexOf('id: "I08"'));
    assert.match(installer, /export const requiredIds = .*"I07"/);
    assert.match(i07, /boundaryRoot: context\.fixturesRoot, inventoryParent: true/);
    assert.match(i07, /path: "drift-src\/bundle-manifest.json", fields: \["sha256", "mtimeNs", "ctimeNs"\]/);
    assert.equal(typeof snap, "function"); assert.equal(typeof unchanged, "function"); assert.equal(typeof preserved, "function");
    return { publicSymbols: 3, registeredI07: true, parentInventoryWired: true, driftFieldsWired: true,
      hashes: Object.fromEntries(["staging-preservation-snapshot.mjs", "installer-cases.mjs", "staging-copy-boundary.mjs", "staging-copy-boundary-loader.mjs", "../source-bundle-stage.mjs"].map(name => [name, sha(fs.readFileSync(path.join(here, name)))])) };
  });
  const report = { status: "passed", kind: "small synthetic oracle controls only; NOT full I07 or staging/activation evidence", root, node: process.version, platform: process.platform, checks: results.length, results };
  fs.writeFileSync(path.join(root, "staging-final-results.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { status: "failed", root, results, error: String(error.stack ?? error) };
  fs.writeFileSync(path.join(root, "staging-final-failure.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
