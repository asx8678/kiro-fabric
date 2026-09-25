// Focused removal regressions, NOT the deleted release-grade behavioral suite.
// All writes stay in fresh retained fixtures; no browser, network, install or cleanup.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const requiredIds = ["NB01", "NB02", "NB03", "NB04", "NB05", "NB06"];
const allow = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
const loadApi = root => import(pathToFileURL(path.join(root, "dist/index.js")).href);

/** Retain only rg on a fresh PATH; never inherit a browser CLI directory. */
async function withoutBrowser(context, action) {
  const previous = process.env.PATH;
  const candidates = (previous ?? "").split(path.delimiter).filter(directory => path.isAbsolute(directory));
  const selected = candidates.map(directory => path.join(directory, "rg")).find(file => fs.existsSync(file));
  assert.ok(selected, "ripgrep is a required non-browser prerequisite");
  const bin = path.join(context.fixturesRoot, "non-browser-bin");
  fs.mkdirSync(bin, { mode: 0o700 });
  fs.symlinkSync(fs.realpathSync(selected), path.join(bin, "rg"));
  assert.deepEqual(fs.readdirSync(bin), ["rg"]);
  process.env.PATH = bin;
  try { return await action(); }
  finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
}

function options(api, context, overrides = {}) {
  const workspace = path.join(context.fixturesRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  return {
    cwd: workspace, workspaceRoot: workspace,
    configFile: path.join(context.fixturesRoot, "config.json"),
    mcpConfigPath: path.join(context.fixturesRoot, "mcp.json"),
    artifactsRoot: path.join(context.fixturesRoot, "artifacts"),
    localLockRoot: path.join(context.fixturesRoot, "locks"),
    memoryRoot: path.join(context.fixturesRoot, "memory"),
    stateRoot: path.join(context.fixturesRoot, "state"),
    continuityRoot: path.join(context.fixturesRoot, "continuity"),
    config: api.normalizeFabricConfig({ mcp: { enabled: false }, continuity: { enabled: true } }),
    ...overrides,
  };
}

async function execute(runtime, code, approver = allow) {
  return await runtime.service.execute({ code, approver, timeoutMs: 30000, workspaceBound: true });
}
function succeeded(result) {
  assert.equal(result.success, true, JSON.stringify({ error: result.error, typeErrors: result.typeErrors }));
  assert.equal(result.status, "succeeded");
  return result.value;
}

/** Bounded inventory: never follows links or deletes output. */
function inventory(root) {
  const out = [], pending = [""];
  while (pending.length) {
    const relative = pending.pop();
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      assert.ok(out.length + pending.length < 20000, "bounded output inventory");
      assert.equal(entry.isSymbolicLink(), false, "unexpected output symlink");
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) pending.push(name);
      else { assert.ok(entry.isFile()); out.push(name); }
    }
  }
  return out;
}

export function createCases() {
  return [
    {
      id: "NB01", title: "built exports, declarations and closure contain no browser surface",
      effects: "reads built artifacts and imports the library; no external processes or network",
      run: async context => withoutBrowser(context, async () => {
        const api = await loadApi(context.root);
        for (const name of ["WebProvider", "BrowserProvider", "BrowserHost", "BrowserProfileStore", "resolveBrowserHarnessExecutable", "WebSocketTransportProvider", "RequestBroker", "OutboundGate"]) {
          assert.equal(Object.hasOwn(api, name), false, "removed export: " + name);
        }
        for (const name of ["createKiroRuntime", "createKiroMcpServer", "ActionRegistry", "LocalCodingProvider", "ContinuityProvider", "FoveaProvider"]) assert.equal(typeof api[name], "function", name);
        const dist = path.join(context.root, "dist"), files = inventory(dist);
        assert.ok(files.length > 0);
        assert.deepEqual(files.filter(file => /(^|\/)browser\/|providers\/(?:browser-(?:provider|contract)|web-(?:provider|privacy|snippets))\./u.test(file)), []);
        const declarations = fs.readFileSync(path.join(dist, "index.d.ts"), "utf8");
        assert.doesNotMatch(declarations, /BrowserProvider|WebProvider|FabricWebConfig|FabricBrowserConfig|browserHarness/u);
        const closure = JSON.parse(fs.readFileSync(path.join(dist, "kiro-agent-closure/closure-manifest.json"), "utf8"));
        assert.doesNotMatch(JSON.stringify(closure), /browser-harness|src\/browser\/|skills\/browser-harness/u);
        return { builtFiles: files.length, browserExports: 0, browserOnPath: false };
      }),
    },
    {
      id: "NB02", title: "legacy web/browser config rejects without rewrite or policy relaxation",
      effects: "writes only private fixture configuration files and verifies unchanged bytes",
      run: async context => {
        const api = await loadApi(context.root), configFile = path.join(context.fixturesRoot, "legacy.json");
        for (const section of ["web", "browser"]) {
          for (const value of [{ enabled: false }, {}, null]) {
            const document = { schemaVersion: 1, [section]: value, approvals: { execute: "deny", network: "deny" }, privacy: { mode: "restricted-web" } };
            const bytes = JSON.stringify(document);
            fs.writeFileSync(configFile, bytes, { mode: 0o600 });
            assert.throws(() => api.loadFabricConfig(configFile), /no longer supported.*remove the/u);
            assert.throws(() => api.normalizeFabricConfig(document), /no longer supported/u);
            assert.equal(fs.readFileSync(configFile, "utf8"), bytes);
          }
        }
        const bytes = JSON.stringify({ approvals: { execute: "deny", network: "deny" }, privacy: { mode: "restricted-web" } });
        fs.writeFileSync(configFile, bytes, { mode: 0o600 });
        const config = api.loadFabricConfig(configFile);
        assert.equal(config.approvals.execute, "deny"); assert.equal(config.approvals.network, "deny");
        assert.equal(config.privacy.mode, "restricted-web");
        assert.equal(Object.hasOwn(config, "web"), false); assert.equal(Object.hasOwn(config, "browser"), false);
        assert.equal(fs.readFileSync(configFile, "utf8"), bytes, "legacy version migration stays in memory");
        return { obsoleteCases: 6, configBytesPreserved: true, retainedPolicy: config.privacy.mode };
      },
    },
    {
      id: "NB03", title: "built runtime starts without browser CLI and preserves binding/discovery",
      effects: "starts compiler/sandbox workers and fixture runtime, then closes only those workers",
      run: async context => withoutBrowser(context, async () => {
        const api = await loadApi(context.root), opts = options(api, context);
        const runtime = api.createKiroRuntime(opts);
        try {
          const names = runtime.providers().map(provider => provider.name).sort();
          assert.deepEqual(names, ["artifacts", "continuity", "fabric", "local", "mcp", "memory", "probe", "repo", "review", "state"]);
          const providers = succeeded(await execute(runtime, "return await tools.providers();"));
          assert.deepEqual(providers.map(provider => provider.name).sort(), names);
          const globals = succeeded(await execute(runtime, 'return {browser: "browser" in globalThis, web: "web" in globalThis, value: 6 * 7};'));
          assert.deepEqual(globals, { browser: false, web: false, value: 42 });
          for (const code of ['return await web.search({query:"public"});', 'return await browser.status({});']) {
            const result = await execute(runtime, code);
            assert.equal(result.success, false); assert.ok(result.typeErrors?.length > 0); assert.equal(result.audits.length, 0);
          }
          const missing = await execute(runtime, 'return await tools.call({ref:"web.search",args:{query:"public"}});');
          assert.equal(missing.success, false);
          return { providerNames: names, globals, removedCallsRejected: 3 };
        } finally { await runtime.close(); }
      }),
    },
    {
      id: "NB04", title: "built execution reads/edits files and persists memory/state/continuity",
      effects: "writes only retained fixture workspace/storage; closes and reopens its runtime",
      run: async context => withoutBrowser(context, async () => {
        const api = await loadApi(context.root), opts = options(api, context);
        let runtime = api.createKiroRuntime(opts);
        try {
          const result = await execute(runtime, `
            await local.write({path:"note.txt",content:"before"});
            const first = await local.read({path:"note.txt"});
            await local.edit({path:"note.txt",expectedSha256:first.sha256,edits:[{oldText:"before",newText:"after"}]});
            const shell = await local.shell({command:"printf non-browser",timeoutMs:1000});
            await memory.set({key:"removal-probe",value:{saved:true}});
            await state.set({key:"removal-probe",value:{count:1},expectedRevision:0});
            const task = await continuity.create({objective:"non-browser verification"});
            const checkpoint = await continuity.checkpoint({taskId:task.taskId,expectedRevision:task.revision,requestId:"removal-checkpoint",facts:[{kind:"decision",text:"browser removed"}]});
            return {shell,file:await local.read({path:"note.txt"}),memory:await memory.get({key:"removal-probe"}),state:await state.get({key:"removal-probe"}),task:checkpoint};
          `);
          const value = succeeded(result);
          assert.equal(value.file.text, "after"); assert.deepEqual(value.memory.value, { saved: true }); assert.deepEqual(value.state.value, { count: 1 });
          assert.equal(value.shell.stdout, "non-browser"); assert.equal(value.shell.exitCode, 0);
          assert.ok(result.audits.some(audit => audit.ref === "local.edit" && audit.success));
          await runtime.close(); runtime = api.createKiroRuntime(opts);
          const again = succeeded(await execute(runtime, `return {memory:await memory.get({key:"removal-probe"}),state:await state.get({key:"removal-probe"}),continuity:await continuity.read({taskId:${JSON.stringify(value.task.taskId)},expectedRevision:${value.task.revision}})};`));
          assert.deepEqual(again.memory.value, { saved: true }); assert.deepEqual(again.state.value, { count: 1 });
          assert.match(again.continuity.summary, /browser removed/u);
          assert.equal(fs.readFileSync(path.join(opts.cwd, "note.txt"), "utf8"), "after");
          return { fileBytes: "after", persistedAcrossRuntimeReopen: ["memory", "state", "continuity"], audits: result.audits.length };
        } finally { await runtime.close(); }
      }),
    },
    {
      id: "NB05", title: "denied writes, stale hashes and workspace escapes remain non-effects",
      effects: "writes one fixture file; deliberately rejected writes must leave it unchanged",
      run: async context => {
        const api = await loadApi(context.root), opts = options(api, context);
        fs.writeFileSync(path.join(opts.cwd, "guard.txt"), "original");
        let approvals = 0;
        const deny = { approve: async () => { throw Error("fixture denial"); }, prepareApproval: () => { approvals++; return { decision: "deny", reason: "fixture denial" }; } };
        const runtime = api.createKiroRuntime(opts);
        try {
          const denied = await execute(runtime, 'return await local.write({path:"denied.txt",content:"bad"});', deny);
          assert.equal(denied.success, false); assert.match(denied.error, /fixture denial/u); assert.equal(approvals, 1);
          assert.equal(fs.existsSync(path.join(opts.cwd, "denied.txt")), false);
          const stale = await execute(runtime, `return await local.edit({path:"guard.txt",expectedSha256:"${"0".repeat(64)}",edits:[{oldText:"original",newText:"bad"}]});`);
          assert.equal(stale.success, false); assert.equal(fs.readFileSync(path.join(opts.cwd, "guard.txt"), "utf8"), "original");
          const escape = await execute(runtime, 'return await local.write({path:"../escaped.txt",content:"bad"});');
          assert.equal(escape.success, false); assert.equal(fs.existsSync(path.join(context.fixturesRoot, "escaped.txt")), false);
        } finally { await runtime.close(); }
        const unbound = api.createKiroRuntime({ ...opts, workspaceRoot: undefined });
        try {
          assert.equal(unbound.providers().find(provider => provider.name === "local").available, false);
          const result = await unbound.service.execute({ code: 'return await local.read({path:"guard.txt"});', approver: allow, timeoutMs: 30000, workspaceBound: false });
          assert.equal(result.success, false);
        } finally { await unbound.close(); }
        return { deniedBeforeWrite: true, staleHashRejected: true, workspaceEscapeRejected: true, cwdDidNotGrantWorkspace: true };
      },
    },
    {
      id: "NB06", title: "retained restricted-web mode blocks unmediated execution before approval",
      effects: "isolated allow-host runtime; shell and synthetic MCP are refused without dispatch",
      run: async context => {
        const api = await loadApi(context.root), opts = options(api, context, { config: api.normalizeFabricConfig({ mcp: { enabled: false }, privacy: { mode: "restricted-web" } }) });
        const runtime = api.createKiroRuntime(opts);
        let dispatches = 0, approvals = 0;
        const observedAllow = { approve: async () => { approvals++; }, prepareApproval: () => { approvals++; return { decision: "allow" }; } };
        runtime.registry.register({ name: "mcp", description: "inert egress control", list: async () => [{name:"egress",description:"fixture",risk:"network",inputSchema:{type:"object",properties:{},additionalProperties:false}}], invoke: async () => { dispatches++; return true; } });
        try {
          const refused = [
            'return await local.shell({command:"printf forbidden > privacy-denied.txt"});',
            'return await tools.call({ref:"local.shell",args:{command:"printf forbidden > privacy-denied.txt"}});',
            'return await probe.run({id:"fixture",executable:"/never-dispatch",args:[]});',
            'return await tools.call({ref:"probe.run",args:{id:"fixture",executable:"/never-dispatch",args:[]}});',
            'return await tools.call({ref:"mcp.egress",args:{}});',
            'return await mcp.servers();',
            'return await tools.call({ref:"mcp.remote/fixture/egress",args:{}});',
          ];
          for (const code of refused) {
            const result = await execute(runtime, code, observedAllow);
            assert.equal(result.success, false); assert.match(result.error, /restricted-web/u);
          }
          assert.equal(dispatches, 0); assert.equal(approvals, 0);
          assert.equal(fs.existsSync(path.join(opts.cwd, "privacy-denied.txt")), false);
          assert.equal(succeeded(await execute(runtime, "return 42;")), 42);
          return { refusedPaths: ["local.shell", "probe.run", "mcp.egress", "mcp.servers", "mcp.remote/fixture/egress"], rejectedForms: refused.length, approvals, dispatches };
        } finally { await runtime.close(); }
      },
    },
  ];
}
