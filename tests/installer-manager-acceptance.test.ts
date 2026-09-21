import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

// Complements the existing restore-specific CLI matrix and postcommit/lifecycle
// integration. These are actual manager subprocesses, no parser-only assertions.
for (const command of ["install", "update", "rollback", "uninstall", "recover"]) {
  it.each([[], ["--non-interactive"], ["--json"], ["--json", "--non-interactive"]].map(flags => [flags]))(`${command} refuses EOF mutation without consent before prerequisites/backup/home effects (%j)`, flags => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-consent-acceptance-")));
    try {
      const home = path.join(root, "home"), kiro = path.join(home, ".kiro"); fs.mkdirSync(home, { mode: 0o700 });
      const result = spawnSync(process.execPath, [new URL("../scripts/install-manager.mjs", import.meta.url).pathname, command, ...flags], { cwd: root, env: { HOME: home, KIRO_HOME: kiro, PATH: "/no-client-or-network-tools", TMPDIR: root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
      expect(result.error).toBeUndefined(); expect(result.status).toBe(2); expect(result.stderr).not.toContain("Continue?");
      if (flags.includes("--json")) {
        expect(result.stderr).toBe(""); expect(result.stdout.trim().split("\n")).toHaveLength(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 2, outcome: "usage", committed: false, recoveryRequired: false });
        expect(JSON.parse(result.stdout).error).toContain("--yes");
      } else { expect(result.stdout).toBe(""); expect(result.stderr).toContain("--yes"); }
      expect(fs.readdirSync(home)).toEqual([]);
    } finally { removeFixtureSync(root, { recursive: true, force: true }); }
  });
}
