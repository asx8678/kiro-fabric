import { execFile } from "node:child_process";
import { opendir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const uncertain = (): Error => new Error("Local shell cleanup uncertain");
const PROC_BATCH = 8;
const PROC_ENTRY_LIMIT = 32768;

/** Internal process evidence, not containment. Missing/restricted evidence must
 * never be treated as observed termination. Keep each probe within 200ms and
 * the caller's cleanup deadline, including directory enumeration and reads. */
export async function localProcessGroupAlive(pid: number, end: number): Promise<boolean> {
  try { process.kill(-pid, 0); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (process.platform !== "darwin" || code !== "EPERM") throw uncertain();
  }
  const probeEnd = Math.min(end, performance.now() + 200);
  const remaining = probeEnd - performance.now();
  if (remaining <= 0) throw uncertain();
  const controller = new AbortController();
  const check = (): void => {
    if (controller.signal.aborted || performance.now() >= probeEnd) throw uncertain();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(uncertain()); }, remaining);
  });
  const observe = async (): Promise<boolean> => {
    if (process.platform === "darwin") {
      const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "pgid=,stat="], {
        encoding: "utf8", env: { LC_ALL: "C" }, timeout: Math.max(1, Math.floor(remaining)),
        signal: controller.signal, maxBuffer: 4 * 1024 * 1024,
      });
      check();
      if (!stdout.trim()) throw uncertain();
      for (const line of stdout.trim().split("\n")) {
        check();
        const match = /^\s*(\d+)\s+([A-Za-z+<>0-9-]+)\s*$/.exec(line);
        if (!match) throw uncertain();
        if (Number(match[1]) === pid && !match[2]!.startsWith("Z")) return true;
      }
      return false;
    }
    if (process.platform !== "linux") throw uncertain();
    const live = async (entry: string): Promise<boolean> => {
      check();
      let stat: string;
      try { stat = await readFile(`/proc/${entry}/stat`, { encoding: "utf8", signal: controller.signal }); }
      catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
        throw uncertain();
      }
      check();
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).trim().split(/\s+/u);
      if (!stat.startsWith(`${entry} (`) || close < 0 || !/^[A-Za-z]$/u.test(fields[0] ?? "") ||
          !/^\d+$/u.test(fields[1] ?? "") || !/^\d+$/u.test(fields[2] ?? "")) throw uncertain();
      return Number(fields[2]) === pid && !["Z", "X", "x"].includes(fields[0]!);
    };
    // A still-running group leader avoids a host-wide scan in the common case.
    if (await live(String(pid))) return true;
    check();
    // Stream entries instead of allocating all of /proc. At most eight stat
    // reads are pending; abort stops further batches even if an OS read stalls.
    const directory = await opendir("/proc");
    let count = 0;
    let batch: string[] = [];
    for await (const entry of directory) {
      check();
      if (++count > PROC_ENTRY_LIMIT) throw uncertain();
      if (!/^\d+$/u.test(entry.name) || entry.name === String(pid)) continue;
      batch.push(entry.name);
      if (batch.length === PROC_BATCH) {
        if ((await Promise.all(batch.map(live))).some(Boolean)) return true;
        batch = [];
      }
    }
    check();
    return (await Promise.all(batch.map(live))).some(Boolean);
  };
  try { return await Promise.race([observe(), timeout]); }
  catch { throw uncertain(); }
  finally { clearTimeout(timer); controller.abort(); }
}
