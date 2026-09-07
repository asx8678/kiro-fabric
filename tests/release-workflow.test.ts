import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workflow = (name: string) => fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const release = workflow("release");
const step = (text: string, name: string) => {
  const start = text.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`missing workflow step: ${name}`);
  const end = text.indexOf("\n      - ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
};
const run = (text: string) => {
  const command = text.match(/^        run: (.+)$/mu)?.[1];
  if (!command) throw new Error("missing workflow run command");
  if (command !== "|") return command;
  return text.slice(text.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map(line => line.replace(/^          /u, "")).join("\n");
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-release-workflow-")));
  roots.push(root);
  const home = path.join(root, "home");
  const kiroHome = path.join(home, ".kiro");
  fs.mkdirSync(kiroHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  return { root, env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: home, KIRO_HOME: kiroHome } };
};

describe("actual release workflow shell regression", () => {
  it.each([
    ["v1.2.3", 0],
    ["v1.2.4", 1],
    ["", 1],
    ['v$(touch injected)', 1],
    ['v`touch injected`', 1],
    ['v1.2.3\"; touch injected; #', 1],
    ["v1.2.3\n$(touch injected)", 1],
    ["v*", 1],
  ] as const)("compares tag %j as data (status %i)", (tag, status) => {
    const { root, env } = fixture();
    const bind = step(release, "Bind tag to package version");
    expect(bind).toContain('TAG: "${{ github.ref_name }}"');
    const command = run(bind);
    expect(command).not.toContain("${{");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-euc", command], { cwd: root, env: { ...env, TAG: tag }, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(status);
    expect(fs.existsSync(path.join(root, "injected"))).toBe(false);
    expect(fs.readdirSync(env.KIRO_HOME)).toEqual([]);
  });

  it("passes release tag and verified commit only through quoted environment variables", () => {
    const promote = step(release, "Promote exact qualified release assets");
    expect(promote).toContain("TAG: ${{ github.ref_name }}");
    expect(promote).toContain("COMMIT: ${{ needs.verify-tag.outputs.commit }}");
    expect(run(promote)).toContain('--commit "$COMMIT" --tag "$TAG" --require-release-ready');
    expect(run(promote)).not.toContain("${{");
  });

  it("preserves annotated signed tag, exact-commit evidence and exact archive promotion gates", () => {
    for (const gate of [
      `test "$(jq -r '.object.type' <<<"$ref")" = tag`,
      `test "$(jq -r '.verification.verified' <<<"$tag")" = true`,
      `test "$(jq -r '.object.type' <<<"$tag")" = commit`,
      'test "$commit" = "$EXPECTED"',
      "ref: ${{ needs.verify-tag.outputs.commit }}",
      '--commit "$COMMIT" --status success',
      '-n "real-client-${COMMIT}"',
      '--archive "$RUNNER_TEMP/qualification/kiro-fabric-agent.tar.gz"',
      '--sbom "$RUNNER_TEMP/qualification/kiro-fabric-agent.spdx.json"',
      '--qualification "$RUNNER_TEMP/qualification/real-client.json"',
      "needs: [verify-tag, qualify]", "environment: release",
    ]) expect(release).toContain(gate);
    expect(release).not.toContain("pnpm run agent:archive");
  });

  it.each(["ci", "release", "release-candidate", "kiro-agent-real"])("declares Node 24 package manager and ripgrep prerequisites in %s", name => {
    const text = workflow(name);
    expect(text).toContain("node-version: 24");
    expect(text).not.toContain("corepack");
    const jobs = name === "ci" ? text.split("  macos-stage:") : [text];
    for (const job of jobs) {
      expect(job).toContain("npm install --global pnpm@11.20.0");
      expect(job).toContain("command -v rg");
      expect(job).toContain("rg --version");
      expect(job.indexOf("rg --version")).toBeLessThan(job.indexOf("pnpm install --frozen-lockfile"));
      if (job.includes("macos-latest")) expect(job).toContain("brew install ripgrep");
      else if (name === "kiro-agent-real") expect(job).toContain("command -v rg");
      else expect(job).toContain("sudo apt-get install --yes ripgrep");
    }
  });

  it("runs complete portable local runtime and installer/release modules on macOS", () => {
    const mac = workflow("ci").split("  macos-stage:")[1]!;
    for (const suite of ["local-provider", "local-shell", "strict-bootstrap", "workspace-binding", "mcp-process-lifecycle", "approval-projection", "agent-user-install", "installer-executable-trust", "release-workflow", "local-executable", "local-lock-reliability", "local-diagnostics", "local-search-work", "state-reliability", "memory-delete-ack", "agent-doctor"]) {
      expect(mac).toContain(`tests/${suite}.test.ts`);
      expect(fs.existsSync(new URL(`./${suite}.test.ts`, import.meta.url))).toBe(true);
    }
  });
});
