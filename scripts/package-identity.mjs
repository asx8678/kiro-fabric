import { spawnSync } from "node:child_process";

export const uniquePackageRecords = (records) => {
  const unique = new Map();
  for (const record of records) unique.set(`${record.name}\0${record.version}`, record);
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
};

export const assertTrackedGitWorktreeClean = (cwd = process.cwd()) => {
  /** @type {Array<[string, string[]]>} */
  const checks = [
    ["unstaged", ["diff", "--quiet", "--no-ext-diff", "--"]],
    ["staged", ["diff", "--cached", "--quiet", "--no-ext-diff", "--"]],
  ];
  for (const [label, argv] of checks) {
    const result = spawnSync("git", argv, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16_384,
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (result.error) throw new Error(`Cannot verify the tracked Git worktree: ${result.error.message}`);
    if (result.status === 1) throw new Error(`Exact-commit evidence requires no ${label} changes to tracked files`);
    if (result.status !== 0) throw new Error(`Cannot verify the tracked Git worktree: ${(result.stderr ?? "").trim().slice(0, 1_000)}`);
  }
};
