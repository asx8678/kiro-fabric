#!/usr/bin/env node
/** Remove group/other write access from generated dist artifacts before auditing
 * the build. Preserve all other permission bits, including private/executable
 * modes. Reject links and special files; this is not a general filesystem repair
 * tool. Like the build itself, it requires exclusive access to the output tree.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "dist");
if (!fs.existsSync(root)) throw new Error("dist is absent; run the build before normalizing artifact modes");

let files = 0;
let directories = 0;
const pending = [root];
while (pending.length > 0) {
  const target = pending.pop();
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) ||
      (stat.isFile() && stat.nlink !== 1) || (target === root && !stat.isDirectory())) {
    throw new Error(`Unsupported build artifact: ${target}`);
  }
  if ((stat.mode & 0o022) !== 0) {
    fs.chmodSync(target, (stat.mode & 0o7777) & ~0o022);
    if (stat.isDirectory()) directories += 1; else files += 1;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) pending.push(path.join(target, name));
  }
}
console.log(`Normalized dist modes: ${files} files, ${directories} directories tightened`);
