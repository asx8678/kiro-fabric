import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runPinnedRecovery } from "../src/installation/pinned-recovery.mjs";

// Probe the platform's actual inode-pinned mechanism, not just its OS label.
// macOS uses the embedded child; Linux uses /proc/self/fd traversal.
export const hasInstallationRecovery = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-fd-capability-"));
  const lock = path.join(root, "lock"); fs.mkdirSync(lock, { mode: 0o700 });
  let fd: number | undefined;
  try {
    if (process.platform === "darwin") {
      fs.writeFileSync(path.join(lock, "owner.json"), "probe", { mode: 0o600 });
      const id = (file: string) => { const s = fs.statSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino) }; };
      runPinnedRecovery(lock, { root: id(root), lock: id(lock), owner: { file: id(path.join(lock, "owner.json")), hash: createHash("sha256").update("probe").digest("hex") }, claims: [] });
      return true;
    }
    fs.writeFileSync(path.join(root, "owner.json"), "probe", { mode: 0o600 });
    fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const anchor = `${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${fd}`;
    const stat = fs.statSync(path.join(anchor, "owner.json"));
    const expected = fs.statSync(path.join(root, "owner.json"));
    return stat.dev === expected.dev && stat.ino === expected.ino;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ENOSYS", "ENOTSUP", "INSTALL_LOCK_UNSUPPORTED"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
