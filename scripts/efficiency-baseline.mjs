#!/usr/bin/env node
// C1 preparation, not a native-versus-Fabric economic benchmark.
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonChars = (value) => JSON.stringify(value).length;
const fixtureText = (index) => `record ${String(index).padStart(2, "0")}\nstatus=before\nend\n`;
const fileName = (index) => `record-${String(index).padStart(2, "0")}.txt`;
const SPECS = [
  { id: "sequential-17", recipe: "Read first line of records 00..16 sequentially", reads: 17 },
  { id: "sequential-64", recipe: "Read first line of records 00..63 sequentially", reads: 64 },
  { id: "parallel-8", recipe: "Read first line of records 00..07 with concurrency 8", reads: 8 },
  { id: "search-edit-verify", recipe: "Literal search record 07 (limit 1), read lines 1..2, uniquely replace status=before with status=after, verify exact file", reads: null },
  { id: "bounded-help", recipe: "Default api page plus complete api paging (limit 16000, <=16 pages, <=100000 UTF-16 chars)", reads: null },
];
const CONFIG = {
  executor: { timeoutMs: 10000, maxTimeoutMs: 10000, maxNestedResultChars: 20000, maxOutputChars: 200000, maxProviderCalls: 64 },
  approvals: { read: "allow", write: "deny", execute: "deny", network: "deny" },
  mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false }, tracing: { enabled: false },
};
const unknownMeasurement = () => ({
  status: "unrun", success: null, attempts: null, latencyMs: null, returnedChars: null,
  retries: null, artifactRereads: null, result: null, error: null,
});

export function parseArgs(args) {
  if (!Array.isArray(args) || args.length !== 1 || !["manifest", "probe", "--help"].includes(args[0])) {
    throw new Error("usage: node scripts/efficiency-baseline.mjs manifest|probe|--help (no other arguments accepted)");
  }
  return args[0];
}

// Bounded, no-follow inventory. Do not hash user settings, installed profiles or .git contents.
function inventory(targets) {
  const files = [];
  let bytes = 0;
  function visit(relative) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) { files.push({ path: relative, sha256: null, bytes: null }); return; }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Identity inventory refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    } else {
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || files.length >= 4096 || (bytes += stat.size) > 64 * 1024 * 1024) {
        throw new Error("Identity inventory exceeds bounds or contains a special file");
      }
      const content = fs.readFileSync(absolute);
      files.push({ path: relative, sha256: sha256(content), bytes: content.length });
    }
  }
  for (const target of targets) visit(target);
  return { sha256: sha256(JSON.stringify(files)), files };
}

function identity() {
  let head = null;
  try {
    // Fixed executable/argv, no shell, pager, global config or fsmonitor.
    head = execFileSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "rev-parse", "--verify", "HEAD"], {
      cwd: ROOT, encoding: "utf8", timeout: 2000, maxBuffer: 256,
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!/^[a-f0-9]{40,64}$/.test(head)) head = null;
  } catch { /* A source archive can have no Git metadata. */ }
  return {
    root: ROOT, head,
    node: { version: process.version, versions: process.versions, executable: process.execPath, platform: process.platform, arch: process.arch },
    source: inventory(["src"]),
    configuration: inventory(["package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.build.json", "scripts/build.mjs", "scripts/esbuild-common.mjs"]),
    runtime: inventory(["dist/index.js", "dist/chunks", "dist/runtime"]),
    dependencies: inventory(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies ?? {}).sort().map((name) => {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) throw new Error("Invalid dependency name");
      return `node_modules/${name}/package.json`;
    })),
    harness: inventory(["scripts/efficiency-baseline.mjs"]),
    sourceMatchesBuild: null,
    installedProfile: null,
  };
}

export function validateHelpPages(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.ok(Array.isArray(value.pages) && value.pages.length >= 1 && value.pages.length <= 16);
  let expanded = "";
  const checkPage = (page, offset, maxText) => {
    assert.ok(page && typeof page === "object" && !Array.isArray(page));
    assert.equal(page.topic, "api");
    assert.equal(typeof page.text, "string");
    assert.ok(page.text.length <= maxText && jsonChars(page) <= 20000);
    assert.equal(typeof page.truncated, "boolean");
    if (page.truncated) {
      assert.ok(page.text.length > 0);
      assert.equal(page.nextOffset, offset + page.text.length);
    } else assert.equal(page.nextOffset, undefined);
  };
  for (const [index, page] of value.pages.entries()) {
    checkPage(page, expanded.length, 16000);
    assert.equal(page.truncated, index < value.pages.length - 1);
    expanded += page.text;
    assert.ok(expanded.length <= 100000);
  }
  assert.ok(expanded.includes("declare const local:") && expanded.includes("declare const fabric:"));
  assert.ok(!expanded.includes("${LOCAL_GUEST_DECLARATIONS}"));
  checkPage(value.defaultPage, 0, 8000);
  assert.equal(value.defaultPage.text, expanded.slice(0, value.defaultPage.text.length));
  assert.equal(value.defaultPage.truncated, value.defaultPage.text.length < expanded.length);
  return {
    expandedChars: expanded.length, expandedBytes: Buffer.byteLength(expanded), expandedSha256: sha256(expanded),
    defaultPageTextChars: value.defaultPage.text.length, defaultPageJsonChars: jsonChars(value.defaultPage),
    defaultPageTruncated: value.defaultPage.truncated, defaultPageNextOffset: value.defaultPage.nextOffset ?? null,
    pages: value.pages.length,
  };
}

const HELP_CODE = `const defaultPage = await fabric.help({topic:"api"});
const pages: Array<{topic:string;text:string;truncated:boolean;nextOffset?:number}> = [];
let offset = 0;
for (let i = 0; i < 16; i++) {
  const page = await fabric.help({topic:"api",offset,limit:16000});
  pages.push(page);
  if (!page.truncated) return {defaultPage,pages};
  if (page.nextOffset === undefined || page.nextOffset <= offset || page.nextOffset > 100000) throw new Error("Invalid help pagination");
  offset = page.nextOffset;
}
throw new Error("Help page bound exceeded");`;

export function validateExecutionResult(result) {
  assert.ok(result && typeof result === "object" && !Array.isArray(result));
  assert.ok(["succeeded", "failed", "aborted", "timed_out"].includes(result.status));
  assert.equal(typeof result.success, "boolean");
  assert.equal(result.success, result.status === "succeeded");
  assert.ok(Array.isArray(result.audits));
  if (result.success) assert.ok(Object.hasOwn(result, "value"));
}

async function measure(operation, boundary) {
  const row = { ...unknownMeasurement(), boundary, status: "failed", success: false, attempts: 1, retries: 0 };
  const start = performance.now();
  try { await operation(row); row.status = "succeeded"; row.success = true; }
  catch (error) { row.error = String(error).slice(0, 1000); }
  row.latencyMs = performance.now() - start;
  return row;
}

async function probe(report) {
  // Deliberately ignore TMPDIR, HOME, PATH, NODE_OPTIONS and all Fabric/MCP settings.
  // Only our private directory is writable; this is not a hostile-code OS sandbox.
  const temporary = fs.mkdtempSync("/tmp/kiro-efficiency-baseline-");
  const savedEnv = { ...process.env };
  /** @type {{ service: any, close(): Promise<void> } | undefined} */
  let runtime;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, { PATH: "/usr/bin:/bin", HOME: path.join(temporary, "home"), TMPDIR: temporary, LANG: "C.UTF-8" });
    fs.mkdirSync(process.env.HOME, { mode: 0o700 });
    const workspace = path.join(temporary, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    for (let i = 0; i < 64; i++) fs.writeFileSync(path.join(workspace, fileName(i)), fixtureText(i), { mode: 0o600 });
    for (const task of report.tasks.filter((entry) => entry.id !== "bounded-help")) {
      task.fixtureProbe = await measure(async (row) => {
        let returnedChars = 0;
        const returned = (value) => { returnedChars += jsonChars(value); return value; };
        const boundedRead = async (index, limit = 1) => {
          const text = await readFile(path.join(workspace, fileName(index)), "utf8");
          assert.equal(text, fixtureText(index));
          return returned(text.split("\n").slice(0, limit).join("\n"));
        };
        if (task.id === "search-edit-verify") {
          const matches = [];
          for (let i = 0; i < 64; i++) {
            if ((await readFile(path.join(workspace, fileName(i)), "utf8")).includes("record 07")) { matches.push(i); break; }
          }
          returned(matches); assert.deepEqual(matches, [7]);
          assert.equal(await boundedRead(matches[0], 2), "record 07\nstatus=before");
          const before = fixtureText(7);
          assert.equal(before.split("status=before").length, 2);
          const after = before.replace("status=before", "status=after");
          fs.writeFileSync(path.join(workspace, fileName(7)), after);
          returned({ changed: true });
          assert.equal(await readFile(path.join(workspace, fileName(7)), "utf8"), after);
          row.result = returned({ verified: true, afterSha256: sha256(after) });
        } else {
          const values = [];
          if (task.id === "parallel-8") values.push(...await Promise.all(Array.from({ length: 8 }, (_, i) => boundedRead(i))));
          else for (let i = 0; i < task.reads; i++) values.push(await boundedRead(i));
          assert.deepEqual(values, Array.from({ length: task.reads }, (_, i) => `record ${String(i).padStart(2, "0")}`));
          row.result = { verified: true, reads: values.length, valueSha256: sha256(JSON.stringify(values)) };
        }
        row.returnedChars = returnedChars;
        row.artifactRereads = 0;
      }, "deterministic Node fixture helper returns; NOT Fabric/local provider or client");
    }
    const helpTask = report.tasks.find((entry) => entry.id === "bounded-help");
    helpTask.runtimeProbe = await measure(async (row) => {
      const api = await import(pathToFileURL(path.join(ROOT, "dist/index.js")).href);
      const config = api.normalizeFabricConfig(CONFIG);
      runtime = api.createKiroRuntime({
        cwd: workspace, configFile: path.join(temporary, "absent-config.json"), mcpConfigPath: path.join(temporary, "absent-mcp.json"),
        artifactsRoot: path.join(temporary, "artifacts"), config,
      });
      report.effectiveConfig = runtime.service.config;
      report.effectiveConfigSha256 = sha256(JSON.stringify(runtime.service.config));
      // No workspace binding => no local provider, shell, rg or user HOME discovery.
      const result = await runtime.service.execute({ code: HELP_CODE, approver: { async approve(action) {
        assert.equal(action.provider, "fabric");
        assert.equal(action.name, "help");
        assert.equal(action.risk, "read");
      } } });
      validateExecutionResult(result);
      if (!result.success) throw new Error(JSON.stringify({ status: result.status, error: result.error, typeErrors: result.typeErrors }));
      row.returnedChars = jsonChars(result.value);
      row.result = validateHelpPages(result.value);
      assert.equal(result.audits.length, row.result.pages + 1);
      assert.ok(result.audits.every((audit) => audit.ref === "fabric.help"));
      row.artifactRereads = 0;
    }, "built Fabric library execution value JSON; NOT MCP projection or client");
  } finally {
    try { await runtime?.close(); }
    finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, savedEnv);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const mode = parseArgs(args);
  if (mode === "--help") { process.stdout.write("Offline C1: manifest (no tasks run) | probe (disposable Node fixtures + built Fabric help). JSON to stdout. No paths, commands, network, Kiro or profile options.\n"); return 0; }
  const report = {
    schemaVersion: 1, kind: "offline-efficiency-preparation-not-economic-benchmark", mode, timestamp: new Date().toISOString(),
    identity: identity(), identityStableDuringProbe: null,
    fixture: { version: 1, files: 64, sha256: sha256(JSON.stringify(Array.from({ length: 64 }, (_, i) => [fileName(i), fixtureText(i)]))) },
    requestedConfig: CONFIG, requestedConfigSha256: sha256(JSON.stringify(CONFIG)), effectiveConfig: null, effectiveConfigSha256: null,
    conditions: { order: SPECS.map((task) => task.id), helpRuntime: "fresh service, one execution including first compilation; latency includes import/setup", osPageCache: null, modelCache: null },
    tasks: SPECS.map((task) => ({ ...task, fixtureProbe: unknownMeasurement(), runtimeProbe: unknownMeasurement(), clientMeasurement: unknownMeasurement() })),
    economic: { comparableTasksAttempted: 0, comparableTasksSucceeded: 0, model: null, client: null, account: null, inputTokens: null, outputTokens: null, billableCachedTokens: null, billableUncachedTokens: null, credits: null, billedCost: null, costPerSuccessfulTask: null },
  };
  if (mode === "probe") {
    await probe(report);
    const after = identity();
    report.identityStableDuringProbe = JSON.stringify(report.identity) === JSON.stringify(after);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.identityStableDuringProbe === false || report.tasks.some((task) => [task.fixtureProbe, task.runtimeProbe].some((row) => row.status === "failed")) ? 1 : 0;
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 2; });
}
