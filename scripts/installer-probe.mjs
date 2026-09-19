import { spawnSync } from "node:child_process";

/** Only for read-only installer help/version probes, never commands with effects.
 * Retry one timeout with identical arguments and limits; callers still validate
 * the final exit status and output. Other failures are returned without retry.
 * @param {string} executable
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} options
 */
export function runInstallerProbe(executable, args, options) {
  const first = spawnSync(executable, args, options);
  return first.error && "code" in first.error && first.error.code === "ETIMEDOUT"
    ? spawnSync(executable, args, options) : first;
}
