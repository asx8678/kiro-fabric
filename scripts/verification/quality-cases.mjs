// Focused dead-code-cleanup regressions, not release qualification.
// Retain fresh fixtures. No real Git/CLI, repositories, installs, network or cleanup.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { runBounded } from "../fovea-capability-probe.mjs";

export const requiredIds = ["CQ01", "CQ02", "CQ03"];
const probePath = "scripts/fovea-capability-probe.mjs";

export function createCases() {
  return [
    {
      id: "CQ01", title: "capability probe keeps its CLI and isolated scope contracts",
      effects: "retains a fresh private scope; spawns Node only with help/dry-run/invalid options and an empty PATH",
      run: async context => {
        const module = await import(pathToFileURL(path.join(context.root, probePath)).href);
        assert.equal(typeof module.runBounded, "function");
        assert.equal(typeof module.createScope, "function");
        const scope = module.createScope();
        for (const directory of [scope.root, scope.home, scope.workspace, scope.env.KIRO_HOME]) {
          assert.ok(fs.lstatSync(directory).isDirectory());
          assert.equal(fs.lstatSync(directory).mode & 0o777, 0o700);
        }
        assert.equal(scope.env.HOME, scope.home);
        assert.notEqual(scope.home, scope.workspace);
        assert.ok(scope.home.startsWith(scope.root + path.sep));
        assert.ok(scope.workspace.startsWith(scope.root + path.sep));
        const bin = path.join(context.fixturesRoot, "empty-bin");
        fs.mkdirSync(bin, { mode: 0o700 });
        const env = { PATH: bin, HOME: context.fixturesRoot, KIRO_HOME: context.fixturesRoot };
        const cli = args => {
          const result = context.spawn(process.execPath, [path.join(context.root, probePath), ...args], { env, timeoutMs: 15000 });
          assert.equal(result.spawnError, null); assert.equal(result.signal, null);
          return result;
        };
        const help = cli(["--help"]);
        assert.equal(help.code, 0); assert.match(help.stdout, /Usage: fovea-capability-probe/);
        for (const args of [["--dry-run"], ["--native", "--dry-run"]]) {
          const result = cli(args); assert.equal(result.code, 0, result.stderr);
          const report = JSON.parse(result.stdout);
          assert.equal(report.qualified, false); assert.equal(report.automatic, false);
          assert.equal(report.mode, args.includes("--native") ? "native" : "prerequisites");
          assert.deepEqual(report.probes, []); assert.equal(report.scopeRemoved, null);
          assert.equal(report.gates.length, 12);
          assert.ok(report.gates.every(gate => gate.status === "untested" && gate.evidence.length === 0));
        }
        for (const args of [["--allow-live"], ["--dry-run", "--dry-run"]]) {
          const result = cli(args); assert.equal(result.code, 2);
          assert.match(result.stderr, /no qualification granted/); assert.equal(result.stdout, "");
        }
        assert.deepEqual(fs.readdirSync(context.fixturesRoot), ["empty-bin"]);
        return { cliControls: 5, qualificationGranted: false, retainedScope: scope.root, exports: Object.keys(module) };
      },
    },
    {
      id: "CQ02", title: "retained shared process runner reports exit, spawn, output and deadline failures",
      effects: "spawns only owned Node children; terminates only their groups; no cleanup",
      run: async context => {
        const options = { cwd: context.fixturesRoot, env: { PATH: "", HOME: context.fixturesRoot }, timeoutMs: 15000 };
        const run = (code, extra = {}) => runBounded(process.execPath, ["-e", code], { ...options, ...extra });
        const success = await run('process.stdout.write("ok")');
        assert.equal(success.exitCode, 0); assert.equal(success.stdout, "ok");
        assert.equal(success.error, null); assert.equal(success.stopReason, null); assert.equal(success.cleanup, "leader-closed");
        const failure = await run('process.stderr.write("expected");process.exitCode=7');
        assert.equal(failure.exitCode, 7); assert.equal(failure.stderr, "expected"); assert.equal(failure.stopReason, null);
        const absent = await runBounded(path.join(context.fixturesRoot, "absent-executable"), [], options);
        assert.equal(absent.error, "ENOENT"); assert.equal(absent.exitCode, null); assert.equal(absent.cleanup, "not-spawned");
        const overflow = await run('process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)', { maxBytes: 32 });
        assert.equal(overflow.stopReason, "output-limit"); assert.equal(overflow.cleanup, "leader-closed"); assert.equal(overflow.stdout, "");
        const timeout = await run('setInterval(()=>{},1000)', { timeoutMs: 1000 });
        assert.equal(timeout.stopReason, "timeout"); assert.equal(timeout.cleanup, "leader-closed");
        for (const extra of [{ timeoutMs: 0 }, { timeoutMs: 300001 }, { maxBytes: 0 }]) {
          assert.throws(() => runBounded(process.execPath, [], { ...options, ...extra }), /invalid process bounds/);
        }
        return { success: true, failureExit: 7, missingExecutable: "ENOENT", boundedOutput: true, productionDeadlineMs: 1000 };
      },
    },
    {
      id: "CQ03", title: "active core APIs work without obsolete wrappers or blanket lint exemption",
      effects: "bundles local core modules into a retained fixture; reads fixture files and runs a fixed fake Git executable",
      run: async context => {
        const names = ["astgrep", "build", "cochange", "discover", "git", "graph", "ops", "context"];
        const outfile = path.join(context.fixturesRoot, "core.mjs");
        await build({ stdin: { contents: names.map(name => `export * as ${name} from ${JSON.stringify(path.join(context.root, "src/fovea/core", name + ".ts"))};`).join("\n"), resolveDir: context.root, loader: "ts" },
          outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
        const core = await import(pathToFileURL(outfile).href);
        for (const [name, removed] of /** @type {Array<[string, string[]]>} */ ([
          ["astgrep", ["hasAstGrep"]], ["build", ["listFiles", "assembleGraphWithIndex", "isGeneratedSource"]],
          ["cochange", ["COCHANGE_HALF_LIFE_DAYS", "recencyFactor", "scorePair"]], ["discover", ["synthesize"]],
          ["git", ["MAX_DIFF_HUNKS_PER_FILE", "parseZeroContextDiff"]],
          ["ops", ["ensureState", "ensureStateBackground", "evictState", "getInflight", "getState", "coverageSummary", "resolveSeeds", "historySeedWeights", "estimateTokens"]],
        ])) for (const symbol of removed) assert.equal(Object.hasOwn(core[name], symbol), false, name + "." + symbol);
        for (const operation of ["sketch", "focus", "dwell", "impact"]) assert.equal(typeof core.ops[operation], "function");
        assert.equal(core.build.isGeneratedSourceBytes("a.ts", Buffer.from("export const a = 1;")), false);
        assert.equal(core.build.isGeneratedSourceBytes("a.min.js", Buffer.from("short")), true);
        assert.equal(core.build.isGeneratedSourceBytes("a.ts", Buffer.from("x".repeat(4000))), true);
        assert.equal(core.cochange.effectiveWeight(8, 0), 8); assert.equal(core.cochange.effectiveWeight(8, 30), 4);
        const sigs = core.discover.aggregateFiles({
          a: core.discover.harvestFile("TypeScript", 'routes.serve("/api/a");\nroutes.serve("/api/b");'),
          b: core.discover.harvestFile("TypeScript", 'routes.serve("/api/c");\nroutes.serve("/api/d");'),
        });
        const promoted = core.discover.promote(sigs);
        assert.equal(promoted.length, 1); assert.equal(promoted[0].implicit, true);
        assert.equal(promoted[0].evidence.n, 4); assert.deepEqual(core.discover.promote(sigs, promoted), []);
        const workspace = path.join(context.fixturesRoot, "workspace"); fs.mkdirSync(workspace, { mode: 0o700 });
        fs.writeFileSync(path.join(workspace, "a.ts"), "export const a = 1;\n", { mode: 0o600 });
        const owned = { store: new Map(), sessionStore: new Map(), parserPath: "", storageRoot: context.fixturesRoot,
          signal: new AbortController().signal, sourceRoot: workspace, snapshotRoot: workspace, gitFailures: [], focusKey: "quality", spills: new Map() };
        await core.context.coreContext.run(owned, async () => {
          const cache = core.build.cachePathFor(workspace);
          assert.equal(core.build.cachePathFor(workspace), cache);
          assert.notEqual(core.build.cachePathFor(workspace + "-other"), cache);
          assert.equal(await core.astgrep.hasAstGrepAsync(), false);
          owned.parserPath = path.join(context.fixturesRoot, "never-executed-parser");
          assert.equal(await core.astgrep.hasAstGrepAsync(), true);
          const discovery = await core.build.discoverFiles(workspace);
          assert.deepEqual(discovery.files, ["a.ts"]);
          const facts = { "a.ts": { sha1: "fixture", symbols: [], imports: [], calls: [], literals: [], anchors: [] } };
          const store = { root: workspace, rulesSha: "fixture-rules", enrolled: new Set(),
            facts: new Map(Object.entries(facts)), failedSha: new Map(), tainted: new Set(), generated: new Set(),
            meta: new Map([["a.ts", { size: 20, mtime: 123 }]]), savedAt: 0 };
          await core.build.persistFacts(store);
          const [header, cached] = fs.readFileSync(cache, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
          assert.equal(header.root, workspace); assert.equal(header.rulesSha, "fixture-rules");
          assert.equal(cached.file, "a.ts"); assert.equal(cached.sha1, "fixture");
          assert.deepEqual(cached.facts.symbols, []); assert.ok(store.savedAt > 0);
          const assembled = await core.graph.assembleGraphWithIndex(workspace, discovery.files, facts);
          assert.equal(assembled.graph.nodes[0].id, "file:a.ts"); assert.deepEqual(assembled.graph.files, ["a.ts"]);
          const fakeGit = path.join(context.fixturesRoot, "fake-git");
          fs.writeFileSync(fakeGit, '#!/bin/sh\ncase " $* " in\n  *" rev-parse --show-prefix "*) printf "\\n" ;;\n  *" diff "*) printf "%s\\n" "diff --git a/a.ts b/a.ts" "--- a/a.ts" "+++ b/a.ts" "@@ -1 +1 @@" "-old" "+new" ;;\n  *) exit 1 ;;\nesac\n', { mode: 0o700 });
          owned.gitPath = fakeGit;
          const hunks = await core.git.diffHunks(workspace);
          assert.ok(hunks instanceof Map); assert.equal(hunks.size, 1);
          assert.deepEqual(hunks.get("a.ts").hunks, [{ newStart: 1, newLines: 1 }]);
        });
        const config = JSON.parse(fs.readFileSync(path.join(context.root, "knip.json"), "utf8"));
        assert.ok(!config.entry.includes("src/fovea/core/*.ts"));
        assert.ok(!config.entry.includes(probePath));
        return { coreOperations: 4, discoveryFiles: 1, promotedRules: 1, diffFiles: 1, blanketCoreExemption: false };
      },
    },
  ];
}
