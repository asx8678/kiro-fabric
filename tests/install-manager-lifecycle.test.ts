import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fixture } from "./bundle-fixture.js";
import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { canonical, createBundleManifest, sha256 } from "../scripts/bundle-contract.mjs";
import { installCompleteGeneration } from "../scripts/managed-installation.mjs";
import { shellQuote } from "../scripts/install-manager.mjs";

const manager = fileURLToPath(new URL("../scripts/install-manager.mjs", import.meta.url));
const roots: string[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Cold-start allowance is independent of the production 5s shutdown grace.
const START_BUDGET = 25_000;
const EXIT_BUDGET = 15_000;
const TEST_BUDGET = 90_000;
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
async function until(check: () => boolean, message: () => string, budget: number) {
  const end = Date.now() + budget;
  while (!check()) {
    if (Date.now() >= end) throw new Error(message());
    await pause(20);
  }
}

async function setup(packaged = false, failSpawn = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-lifecycle-")));
  roots.push(root); fs.chmodSync(root, 0o700);
  const home = path.join(root, "home"), kiroHome = path.join(home, ".kiro");
  const bin = path.join(root, "bin"), project = path.join(root, "project"), stop = path.join(root, "stop");
  for (const directory of [home, bin, project]) fs.mkdirSync(directory, { mode: 0o700 });
  const client = path.join(root, "client.cjs");
  fs.writeFileSync(client, `const fs = require('node:fs');
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const mode = process.env.CLIENT_MODE;
if (mode === 'resistant' || mode === 'cooperative') {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {
    emit({ kind: 'signal', signal });
    if (mode === 'cooperative') process.exit(42);
  });
}
emit({ kind: 'ready', pid: process.pid, ppid: process.ppid });
if (mode === 'self-signal') process.kill(process.pid, process.env.CLIENT_SIGNAL);
if (mode === 'exit') process.exit(23);
let count = 0;
setInterval(() => {
  if (fs.existsSync(${JSON.stringify(stop)})) process.exit(0);
  emit({ kind: 'heartbeat', count: ++count });
}, 30);
// Last-resort fixture lifetime, not the shutdown behavior under test.
setTimeout(() => process.exit(90), 45_000);
`, { mode: 0o600 });
  fs.writeFileSync(path.join(bin, "kiro-cli"), `#!/bin/sh
case "$*" in
  --version) printf 'kiro-cli 2.21.1\\n' ;;
  'agent validate --help') ${failSpawn ? `${shellQuote(process.execPath)} -e ${shellQuote(`require('node:fs').unlinkSync(${JSON.stringify(path.join(bin, "kiro-cli"))})`)}; ` : ""}printf '%s\\n' --path ;;
  '--v3 --agent kiro-fabric') exec ${shellQuote(process.execPath)} ${shellQuote(client)} ;;
  *) exit 91 ;;
esac
`, { mode: 0o700 });
  const bundle = await fixture(`${process.platform}-${process.arch}`); roots.push(bundle);
  if (packaged) {
    // Compile into a task-owned fixture, never the shared build/staging tree.
    const outfile = path.join(bundle, "manager/install-manager.mjs");
    const compiled = await build({ entryPoints: [manager], outfile, bundle: true, platform: "node", format: "esm", target: "node24", splitting: false, sourcemap: false, metafile: true, logLevel: "silent" });
    expect(Object.keys(compiled.metafile!.inputs).some(input => /node_modules\/|(?:^|\/)tests\//u.test(input))).toBe(false);
    fs.chmodSync(outfile, 0o600);
    const node = path.join(bundle, "tools/node");
    fs.copyFileSync(process.execPath, node); fs.chmodSync(node, 0o700);
    const original = JSON.parse(fs.readFileSync(path.join(bundle, "bundle-manifest.json"), "utf8"));
    original.tools.node.version = process.versions.node;
    Object.assign(original.tools.node.members.find((member: { path: string }) => member.path === "tools/node"), { size: fs.statSync(node).size, sha256: sha256(fs.readFileSync(node)) });
    const manifest = await createBundleManifest(bundle, original);
    fs.writeFileSync(path.join(bundle, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600 });
  }
  const installed = await installCompleteGeneration(bundle, { kiroHome, userHome: home, env: {}, provenance: "source", validateCandidate: async () => {} });
  return {
    root, stop,
    launch(mode: string, signal: NodeJS.Signals = "SIGTERM", embedded = false) {
      const embeddedScript = `import fs from 'node:fs';
import { runManager } from ${JSON.stringify(new URL("../scripts/install-manager.mjs", import.meta.url).href)};
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
const prior = () => {};
for (const signal of signals) process.on(signal, prior);
const before = signals.map(signal => process.listenerCount(signal));
const code = await runManager(['start', '--kiro-home', ${JSON.stringify(kiroHome)}]);
fs.writeFileSync(${JSON.stringify(path.join(root, "embedded-result"))}, JSON.stringify({ code, before, after: signals.map(signal => process.listenerCount(signal)) }));
process.exitCode = code;
`;
      const child = spawn(packaged ? installed.paths.launcher : process.execPath,
        packaged ? ["start"] : embedded ? ["--input-type=module", "-e", embeddedScript] : [manager, "start", "--kiro-home", kiroHome], {
          cwd: project, env: { HOME: home, KIRO_HOME: kiroHome, PATH: bin, TMPDIR: root, LANG: "C", LC_ALL: "C", CLIENT_MODE: mode, CLIENT_SIGNAL: signal },
          stdio: ["ignore", "pipe", "pipe"],
        });
      let output = "", stderr = "", error: Error | undefined, closed = false;
      let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      const events: Array<{ kind: string; pid?: number; ppid?: number; signal?: string }> = [];
      child.stdout!.on("data", chunk => {
        output += chunk;
        for (;;) {
          const end = output.indexOf("\n"); if (end < 0) break;
          events.push(JSON.parse(output.slice(0, end))); output = output.slice(end + 1);
        }
      });
      child.stderr!.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.once("error", value => { error = value; });
      child.once("exit", (code, signal) => { exit = { code, signal }; });
      child.once("close", () => { closed = true; });
      const diagnostic = () => JSON.stringify({ error: error?.message, exit, stderr, events: events.slice(-5) });
      return {
        child, events,
        async ready() {
          await until(() => { if (error) throw error; if (exit) throw new Error(diagnostic()); return events.some(event => event.kind === "heartbeat"); }, diagnostic, START_BUDGET);
          expect(error).toBeUndefined();
          const identity = events.find(event => event.kind === "ready")!;
          expect(identity.ppid).toBe(child.pid);
          return identity.pid!;
        },
        async exited(expectedError?: RegExp) {
          await until(() => { if (error) throw error; return closed; }, diagnostic, EXIT_BUDGET);
          expect(error).toBeUndefined();
          if (expectedError) expect(stderr).toMatch(expectedError); else expect(stderr).toBe("");
          return exit;
        },
        async cleanup() {
          // Cooperatively stop even a regression-orphaned client. Signal only the
          // exact task-owned manager handle, never a group or discovered PID.
          fs.writeFileSync(stop, "stop", { mode: 0o600 });
          if (!exit && !error) child.kill("SIGTERM");
          try {
            try { await until(() => closed, diagnostic, EXIT_BUDGET); }
            catch {
              if (!exit && !error) child.kill("SIGKILL");
              await until(() => closed, diagnostic, EXIT_BUDGET);
            }
          } finally { child.stdout!.destroy(); child.stderr!.destroy(); }
        },
      };
    },
  };
}

function expectGone(pid: number) {
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
}

describe("manager-owned client lifecycle (inert fixtures only)", () => {
  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("reaps a persistent client on manager-only %s", async signal => {
    const f = await setup(), running = f.launch("inert");
    try {
      const pid = await running.ready();
      expect(running.child.kill(signal)).toBe(true);
      expect(await running.exited()).toEqual({ code: null, signal });
      expectGone(pid);
    } finally { await running.cleanup(); }
  }, TEST_BUDGET);

  it("bounds resistant-child teardown and ignores repeated manager signals", async () => {
    const f = await setup(), running = f.launch("resistant");
    // A sibling in the same process group must not receive any forwarded signal.
    const sibling: ChildProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 45000)"], { stdio: "ignore" });
    let siblingError: Error | undefined, siblingExited = false;
    sibling.once("error", error => { siblingError = error; }); sibling.once("exit", () => { siblingExited = true; });
    try {
      const pid = await running.ready(), start = Date.now();
      expect(siblingError).toBeUndefined();
      running.child.kill("SIGTERM");
      await until(() => running.events.some(event => event.kind === "signal"), () => "No forwarded signal", EXIT_BUDGET);
      running.child.kill("SIGTERM"); running.child.kill("SIGINT");
      expect(await running.exited()).toEqual({ code: null, signal: "SIGTERM" });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(4_900);
      expect(elapsed).toBeLessThan(EXIT_BUDGET);
      expect(running.events.filter(event => event.kind === "signal")).toEqual([{ kind: "signal", signal: "SIGTERM" }]);
      expectGone(pid); expect(siblingExited).toBe(false);
    } finally {
      try { await running.cleanup(); }
      finally {
        if (!siblingExited && !siblingError) sibling.kill("SIGKILL");
        await until(() => siblingExited || !!siblingError, () => "Fixture sibling did not exit", EXIT_BUDGET);
      }
    }
  }, TEST_BUDGET);

  it("keeps manager termination semantics when a cooperative client returns a code", async () => {
    const f = await setup(), running = f.launch("cooperative");
    try {
      const pid = await running.ready(); running.child.kill("SIGTERM");
      expect(await running.exited()).toEqual({ code: null, signal: "SIGTERM" }); expectGone(pid);
    } finally { await running.cleanup(); }
  }, TEST_BUDGET);

  it.each(["SIGTERM", "SIGINT"] as const)("preserves client-originated %s", async signal => {
    const f = await setup(), running = f.launch("self-signal", signal);
    try { expect(await running.exited()).toEqual({ code: null, signal }); }
    finally { await running.cleanup(); }
  }, TEST_BUDGET);

  it("lets embedded runManager return a signal status and removes its listeners", async () => {
    const f = await setup(), running = f.launch("inert", "SIGTERM", true);
    try {
      const pid = await running.ready(); running.child.kill("SIGTERM");
      expect(await running.exited()).toEqual({ code: 143, signal: null }); expectGone(pid);
      const result = JSON.parse(fs.readFileSync(path.join(f.root, "embedded-result"), "utf8"));
      expect(result.code).toBe(143); expect(result.after).toEqual(result.before);
    } finally { await running.cleanup(); }
  }, TEST_BUDGET);

  it("supervises through the installed shell launcher and bundled manager", async () => {
    const f = await setup(true), running = f.launch("inert");
    try {
      const pid = await running.ready(); running.child.kill("SIGTERM");
      expect(await running.exited()).toEqual({ code: null, signal: "SIGTERM" }); expectGone(pid);
    } finally { await running.cleanup(); }
  }, TEST_BUDGET);

  it.each([false, true])("restores embedded listeners after normal exit or spawn failure (failure=%s)", async failSpawn => {
    const f = await setup(false, failSpawn), running = f.launch("exit", "SIGTERM", true);
    try {
      expect(await running.exited(failSpawn ? /ENOENT/u : undefined)).toEqual({ code: failSpawn ? 5 : 23, signal: null });
      const result = JSON.parse(fs.readFileSync(path.join(f.root, "embedded-result"), "utf8"));
      expect(result.before).toEqual([1, 1, 1]); expect(result.after).toEqual(result.before);
    } finally { await running.cleanup(); }
  }, TEST_BUDGET);
});
