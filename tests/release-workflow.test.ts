import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installerSuiteFiles } from "../scripts/test-installer.mjs";

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

describe("canonical release version consistency (source-only)", () => {
  const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
  const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const docs = fs.readFileSync(new URL("../docs/release.md", import.meta.url), "utf8");

  it("prepares 0.65.0 with matching changelog and migration headings", () => {
    expect(version).toBe("0.65.0");
    const headings = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)$/gmu)].map(match => match[1]);
    expect(headings[0]).toBe(version);
    expect(headings.filter(heading => heading === version)).toHaveLength(1);
    expect(headings).toContain("0.64.0");
    expect(changelog).toContain("Replaced all prior integration modes with one Kiro Power product.");
    expect(docs).toContain(`## ${version} migration`);
    expect(docs).toContain(`v${version}`);
  });

  it.each([["v0.65.0", 0], ["v0.64.0", 1], ["0.65.0", 1]] as const)("binds the canonical package to tag %s (status %i)", (tag, status) => {
    const { root, env } = fixture();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
    const result = spawnSync("bash", ["--noprofile", "--norc", "-euc", run(step(release, "Bind tag to package version"))], {
      cwd: root, env: { ...env, TAG: tag }, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(status);
    expect(fs.readdirSync(env.KIRO_HOME)).toEqual([]);
  });
});

describe("installer production fail-closed gates", () => {
  it.each(["--require-release-ready", "--assets"])("blocks %s before any legacy artifact read or promotion", flag => {
    const { root, env } = fixture();
    const script = new URL("../scripts/release-candidate-report.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [script.pathname, flag, path.join(root, "assets"), "--archive", path.join(root, "missing.tar.gz")], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Production release trust root unavailable: distribution BLOCKED");
    expect(result.stderr).not.toContain("ENOENT");
    expect(fs.existsSync(path.join(root, "assets"))).toBe(false);
  });

  it("places the bootstrap readiness gate before evidence download and promotion", () => {
    const gate = step(release, "Require production installer signing and native qualification readiness");
    expect(run(gate)).toBe("node scripts/generate-installer-bootstrap.mjs");
    expect(release.indexOf(gate)).toBeLessThan(release.indexOf("      - name: Download exact-commit real-client evidence"));
    for (const costly of ["npm install --global", "pnpm install --frozen-lockfile", "pnpm run check", "Provision ripgrep"]) expect(release.indexOf(gate)).toBeLessThan(release.indexOf(costly));
    expect(run(step(release, "Promote exact qualified release assets"))).toContain("--require-release-ready");
  });

  it("requires complete native bundle execution and byte comparison, not just filename selection", () => {
    const ci = workflow("ci");
    const body = run(step(ci, "Build and exercise the complete native bundle"));
    for (const required of ["pnpm run agent:bundle", "pnpm run build", "node scripts/build-complete-bundle.mjs", 'mv .tmp "$root/first-build"', 'cmp "$root/first.tar.gz" "$archive"', "node scripts/test-installer.mjs run bundle"]) expect(body).toContain(required);
    expect(body.indexOf('mv .tmp')).toBeLessThan(body.indexOf('node scripts/build-complete-bundle.mjs'));
    for (const file of ["installed-independence", "installer-lock", "install-transaction", "managed-installation", "installer-smoke-bundle-acceptance"]) expect(installerSuiteFiles("bundle")).toContain(`tests/${file}.test.ts`);
    expect(body).toContain('export HOME="$root/home" KIRO_HOME="$root/kiro"');
    expect(ci.indexOf("Assert actual native target")).toBeLessThan(ci.indexOf("Build and exercise the complete native bundle"));
  });
  it("runs Linux cleanup, search and startup regressions on every native target", () => {
    const ci = workflow("ci");
    const body = run(step(ci, "Isolated native installer and runtime contract tests"));
    expect(body).toContain("node scripts/test-installer.mjs run contracts");
    for (const file of ["local-process-group", "local-shell", "local-search-work", "local-executable", "local-provider", "bundle-contract", "bundle-streaming", "managed-generation", "managed-generation-efficiency", "installer-configuration-backup", "installer-home-preparation", "installer-shell-integration", "installer-cli-contract", "install-manager-start", "launch-profile", "managed-installation-lifecycle", "installer-native-zsh-acceptance"]) expect(installerSuiteFiles("contracts")).toContain(`tests/${file}.test.ts`);
    expect(ci.indexOf("Provision ripgrep for native runtime contracts")).toBeLessThan(ci.indexOf("Isolated native installer and runtime contract tests"));
    expect(body).toContain('HOME="$root/home" KIRO_HOME="$root/kiro"');
  });
  it("asserts actual OS, kernel arch and Node arch, rejecting mismatches", () => {
    const ci = workflow("ci");
    for (const target of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) expect(ci).toContain(`target: ${target}, runner:`);
    expect(ci).toContain("Unscheduled targets remain PENDING");
    const command = run(step(ci, "Assert actual native target"));
    const { root, env } = fixture();
    for (const expected of [
      { EXPECTED_OS: "wrong", EXPECTED_ARCH: "wrong", EXPECTED_TARGET: "wrong" },
      { EXPECTED_OS: os.type(), EXPECTED_ARCH: os.machine(), EXPECTED_TARGET: "wrong" },
      { EXPECTED_OS: os.type(), EXPECTED_ARCH: os.machine(), EXPECTED_TARGET: `${process.platform}-${process.arch}` },
    ]) {
      const result = spawnSync("bash", ["--noprofile", "--norc", "-euc", command], { cwd: root, env: { ...env, ...expected }, encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(expected.EXPECTED_TARGET === "wrong" ? 1 : 0);
    }
  });
});

describe("native cache and qualification privacy registrations", () => {
  it("caches only verified pin/target tool transport and lock/pnpm-version-bound store bytes", () => {
    const native = workflow("ci").split("  installer-native-contracts:")[1]!.split("  macos-stage:")[0]!;
    expect(native).toContain("installer-tools-v1-${{ matrix.target }}"); expect(native).toContain("hashFiles('build-toolchain.json', 'scripts/installer-ci-cache.mjs')");
    expect(native).toContain("node24-pnpm11.20.0"); expect(native).toContain("hashFiles('pnpm-lock.yaml', 'pnpm-workspace.yaml')");
    expect(native).toContain('--verify-store-integrity=true --package-import-method=copy');
    expect(native).not.toContain("restore-keys:"); expect(native).not.toMatch(/path:.*(?:node_modules|[.]tmp)/u);
    expect(run(step(native, "Verify and rematerialize pinned private tools"))).toContain('installer-ci-cache.mjs restore "$TARGET" "$TOOL_TRANSPORT"');
    expect(native.indexOf("Assert actual native target")).toBeLessThan(native.indexOf("Restore untrusted pinned tool transport only"));
  });
  it("uploads only explicit per-attempt sanitized diagnostics, always after raw-home cleanup", () => {
    const real = workflow("kiro-agent-real"), upload = step(real, "Upload bounded nonqualifying failure diagnostics"), cleanup = step(real, "Remove isolated Kiro qualification state");
    expect(upload).toContain("if: always()"); expect(cleanup).toContain("if: always()");
    expect(upload).toContain("retention-days: 7"); expect(upload).toContain("${{ env.FAILURE_OUTPUT }}.driver.json");
    expect(upload).not.toMatch(/[*]|transcript|acp[.]jsonl/u); expect(real).toContain("${{ github.run_id }}-${{ github.run_attempt }}.json");
    expect(real.indexOf(cleanup)).toBeLessThan(real.indexOf(upload));
    expect(run(cleanup)).toContain("finalizeQualificationDiagnostic"); expect(run(cleanup)).toContain('test "$cleanup" = removed');
    expect(run(step(real, "Exercise exact package with the repository-owned real client driver"))).toContain('--failure-output "$FAILURE_OUTPUT"');
    expect(step(real, "Upload privacy-gated qualifying assets only")).toContain("if: success()");
  });
  it("retains complete-bundle exact-archive SBOM sidecar publication without bypassing blocked readiness", () => {
    expect(release).toContain("${{ runner.temp }}/release/*.tar.gz.spdx.json");
    expect(release).toContain("--require-release-ready");
  });
});

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
