import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureRegular, readRegular, validateBundle, sha256, LIMITS } from "./bundle-contract.mjs";
import { captureDirectoryAncestry } from "../src/installation/filesystem-boundary.mjs";
import { pinnedDirectoryIdentity, runPinnedDirectoryOperation, writePinnedDirectoryStream } from "./pinned-directory-child.mjs";

const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const same = (a, b) => a && b && ["dev", "ino", "mode", "uid", "gid"].every(key => a[key] === b[key]);

/** Copy an authenticated local-source snapshot to a NEW private external root.
 * No cp/archive round-trip, pathname-following chmod, or unbounded file buffer.
 * Every output parent is inode-pinned; incomplete output is private evidence.
 * @param {string} source @param {string} output */
export async function stageSourceBundle(source, output) {
  if (!path.isAbsolute(output) || path.resolve(output) !== output) throw Error("Source staging output must be canonical absolute");
  const sourceGuard = captureDirectoryAncestry(source), bundle = await validateBundle(sourceGuard.root);
  const base = captureDirectoryAncestry(path.dirname(output));
  output = path.join(base.root, path.basename(output));
  const contains = (a, b) => { const relative = path.relative(a, b); return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); };
  if (contains(sourceGuard.root, output) || contains(output, sourceGuard.root)) throw Error("Source staging roots must be disjoint");
  const parents = new Map([[base.root, pinnedDirectoryIdentity(fs.lstatSync(base.root, { bigint: true }))]]);
  const manifest = await readRegular(path.join(bundle.root, "bundle-manifest.json"), LIMITS.manifest, { mode: 0o600 });
  const rows = [...bundle.inventory, { path: "bundle-manifest.json", mode: 0o600, size: manifest.length, sha256: sha256(manifest) }];
  /** @template T @param {string} directory @param {(context:import('./pinned-directory-child.mjs').ParentOptions)=>T|Promise<T>} action */
  async function inParent(directory, action) {
    const guard = captureDirectoryAncestry(directory), expected = parents.get(directory);
    if (!expected) throw Error("Unknown source staging parent");
    const check = () => {
      sourceGuard.check(); base.check(); guard.check();
      if (!same(expected, pinnedDirectoryIdentity(fs.lstatSync(directory, { bigint: true })))) throw Error("Source staging parent changed; preserve evidence");
    };
    check();
    const fd = fs.openSync(directory, directoryFlags);
    try {
      if (!same(expected, pinnedDirectoryIdentity(fs.fstatSync(fd, { bigint: true })))) throw Error("Source staging descriptor changed");
      return await action({ fd, cwd: directory, parent: expected, check });
    } finally { fs.closeSync(fd); }
  }
  async function create(directory, name) {
    const entry = await inParent(directory, context => runPinnedDirectoryOperation({ ...context, operation: "mkdir0700", name }));
    if (!entry) throw Error("Missing source staging directory identity");
    const { dev, ino, mode, uid, gid } = entry;
    parents.set(path.join(directory, name), { dev, ino, mode, uid, gid });
  }
  await create(base.root, path.basename(output));
  for (const row of rows) {
    let directory = output;
    const components = row.path.split("/"), name = components.pop();
    if (!name) throw Error("Invalid source staging member");
    for (const component of components) {
      const next = path.join(directory, component);
      if (!parents.has(next)) await create(directory, component);
      directory = next;
    }
    await inParent(directory, async context => {
      await captureRegular(path.join(bundle.root, row.path), row.size, async (handle, size) => {
        const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(size + 1, 64 * 1024));
        let length = 0;
        async function* chunks() {
          while (length <= size) {
            const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size + 1 - length), null);
            if (!bytesRead) break;
            length += bytesRead;
            if (length > size) throw Error("Source staging input grew");
            const chunk = Buffer.from(buffer.subarray(0, bytesRead)); hash.update(chunk); yield chunk;
          }
        }
        await writePinnedDirectoryStream({ ...context, name, mode: row.mode, maxBytes: row.size }, chunks());
        if (length !== row.size || hash.digest("hex") !== row.sha256) throw Error("Source changed during private staging");
        return { value: null, length };
      }, { mode: row.mode });
    });
  }
  sourceGuard.check(); base.check();
  const result = await validateBundle(output);
  if (result.digest !== bundle.digest) throw Error("Private source staging digest mismatch");
  return result;
}
