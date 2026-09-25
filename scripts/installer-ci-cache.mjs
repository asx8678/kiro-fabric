#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonical, checkToolPins, sha256, TARGETS } from "./bundle-contract.mjs";
import { verifyPrivateToolCache } from "./build-private-tools.mjs";
import { cacheDirectory, privateDirectory } from "./installer-artifacts.mjs";
import { captureDirectoryAncestry } from "../src/installation/filesystem-boundary.mjs";

const identity = stat => [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
const membersFor = pins => Object.values(pins).flatMap(pin => pin.members);
/** CI transport is UNTRUSTED bytes, never an executable/cache receipt. Recreate
 * current-owner, single-link files with fixed modes using exclusive creation;
 * hash every byte against committed pins, then run the existing closure verifier.
 * No complete bundles, build receipts, leases, auth homes or node_modules cached.
 * @param {{source:string,destination:string,pins:any,target:string}} options */
export async function rematerializeInstallerToolCache({ source, destination, pins, target }) {
  checkToolPins(pins, undefined, target);
  const sourceGuard = captureDirectoryAncestry(source), parentGuard = privateDirectory(path.dirname(destination));
  const members = membersFor(pins), snapshots = new Map();
  for (const directory of ["", "tools", "notices"]) {
    const absolute = path.join(source, directory), stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) || ![0, process.getuid?.()].includes(stat.uid)) throw new Error("Unsafe CI cache directory");
    const expected = directory ? members.filter(member => path.dirname(member.path) === directory).map(member => path.basename(member.path)).sort() : ["notices", "tools"];
    if (JSON.stringify(fs.readdirSync(absolute).sort()) !== JSON.stringify(expected)) throw new Error("CI cache inventory drift");
    snapshots.set(absolute, identity(stat));
  }
  const unchanged = () => {
    sourceGuard.check(); parentGuard.check();
    for (const [file, before] of snapshots) if (identity(fs.lstatSync(file)) !== before) throw new Error("CI cache changed while rematerializing");
  };
  if (fs.existsSync(destination)) throw new Error("CI cache destination already exists; preserve it");
  const temporary = path.join(path.dirname(destination), `.installer-cache-import-${randomBytes(12).toString("hex")}`);
  fs.mkdirSync(temporary, { mode: 0o700 });
  console.error("[fabric:task-root] " + JSON.stringify({ path: temporary, policy: "retain-if-unpublished" }));
  {
    for (const directory of ["tools", "notices"]) fs.mkdirSync(path.join(temporary, directory), { mode: 0o700 });
    for (const member of members) {
      unchanged();
      const file = path.join(source, member.path), before = fs.lstatSync(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o022) || ![0, process.getuid?.()].includes(before.uid) || before.size !== member.size) throw new Error("Unsafe CI cache member");
      const input = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let output;
      try {
        if (identity(fs.fstatSync(input)) !== identity(before)) throw new Error("CI cache member replaced");
        output = fs.openSync(path.join(temporary, member.path), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, member.path.startsWith("tools/") ? 0o700 : 0o600);
        const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let bytes = 0;
        for (;;) {
          const count = fs.readSync(input, buffer, 0, buffer.length, null); if (!count) break;
          bytes += count; if (bytes > member.size) throw new Error("CI cache member exceeds pin size");
          hash.update(buffer.subarray(0, count)); let written = 0;
          while (written < count) written += fs.writeSync(output, buffer, written, count - written);
        }
        if (bytes !== member.size || hash.digest("hex") !== member.sha256) throw new Error("CI cache member hash mismatch");
        if (identity(fs.fstatSync(input)) !== identity(before) || identity(fs.lstatSync(file)) !== identity(before)) throw new Error("CI cache member changed");
        snapshots.set(file, identity(before)); fs.fsyncSync(output);
      } finally { fs.closeSync(input); if (output !== undefined) fs.closeSync(output); }
    }
    unchanged(); await verifyPrivateToolCache(temporary, pins, target); unchanged();
    fs.renameSync(temporary, destination);
    await verifyPrivateToolCache(destination, pins, target);
    return destination;
  }
}

export async function installerCiCache(action, target, transport, root = fileURLToPath(new URL("..", import.meta.url))) {
  if (!["restore", "save"].includes(action) || !TARGETS.includes(target) || target !== `${process.platform}-${process.arch}`) throw new Error("Usage: installer-ci-cache.mjs restore|save NATIVE_TARGET ABS_TRANSPORT");
  if (!path.isAbsolute(transport)) throw new Error("CI transport must be absolute");
  const config = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8")), pins = config.targets[target];
  checkToolPins(pins, undefined, target);
  const parent = cacheDirectory(root, true), selected = path.join(parent, `private-tools-${sha256(canonical(pins))}`);
  if (action === "restore") {
    if (!fs.existsSync(transport)) return { restored: false };
    // Do not chmod/chown or restore inode-bound receipts from another runner.
    if (fs.existsSync(selected)) { await verifyPrivateToolCache(selected, pins, target); return { restored: false, alreadyVerified: true }; }
    await rematerializeInstallerToolCache({ source: transport, destination: selected, pins, target });
    return { restored: true };
  }
  await verifyPrivateToolCache(selected, pins, target);
  await rematerializeInstallerToolCache({ source: selected, destination: transport, pins, target });
  return { exported: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error("Usage: installer-ci-cache.mjs restore|save NATIVE_TARGET ABS_TRANSPORT");
  console.log(JSON.stringify(await installerCiCache(process.argv[2], process.argv[3], process.argv[4])));
}
