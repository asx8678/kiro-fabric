import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Do not infer openat-like support from the OS name, and never emulate it with
// a racy pathname fallback. Probe a disposable directory exactly as production.
export const hasDirectoryFdTraversal = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-fd-capability-"));
  let fd: number | undefined;
  try {
    fs.writeFileSync(path.join(root, "owner.json"), "probe", { mode: 0o600 });
    fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const anchor = `${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${fd}`;
    const stat = fs.statSync(path.join(anchor, "owner.json"));
    const expected = fs.statSync(path.join(root, "owner.json"));
    return stat.dev === expected.dev && stat.ino === expected.ino;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ENOSYS", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
