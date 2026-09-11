import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { planShellIntegration, applyShellIntegration } from "../scripts/installer-shell-integration.mjs";
import { requireNativeInstallerShell } from "../scripts/test-installer.mjs";

it.skipIf(process.platform !== "darwin")("requires a fresh native macOS zsh terminal to load installer handoff with exact argv/status", () => {
  requireNativeInstallerShell();
  const executable = ["/bin/zsh", "/usr/bin/zsh"].find(file => fs.existsSync(file))!;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-zsh-acceptance-")));
  try {
    const home = path.join(root, "home"), kiro = path.join(home, ".kiro"), bin = path.join(root, "bin"), project = path.join(root, "project ' ü");
    for (const directory of [home, kiro, bin, project, path.join(kiro, "kiro-fabric"), path.join(kiro, "agents")]) fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(kiro, "agents/kiro-fabric.json"), "{}", { mode: 0o600 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nprintf "%s\\n" "$KIRO_FABRIC_LAUNCH_WORKSPACE" "$KIRO_HOME" "$@"\nexit 23\n', { mode: 0o700 });
    const env = { HOME: home, SHELL: executable, PATH: bin, KIRO_HOME: kiro, TERM: "dumb" };
    applyShellIntegration(kiro, planShellIntegration(kiro, { env }));
    const result = spawnSync(executable, ["-d", "-ic", "kiro-cli --v3 chat 'hello world'"], { cwd: project, env, encoding: "utf8", timeout: 10000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(23);
    expect(result.stdout.trim().split("\n")).toEqual([project, kiro, "--agent", "kiro-fabric", "--v3", "chat", "hello world"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
