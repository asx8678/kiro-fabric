// W7 provider inventory and requirements metadata contract. Real source
// ActionRegistry/runtime classes and the real historical product validator;
// all provider storage uses task-owned private fixture roots and an inert
// borrowed Navigator stub. Nothing here builds, installs, or mutates source.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateAgentPackage } from "../validate-agent-package.mjs";
import { verifyBuiltInventory } from "./w7-built-check.mjs";
import {
  loadW7Core,
  loadW7Inventory,
  loadW7Index,
  checkRootTypeExport,
  privateDir,
} from "./w7-inventory-fixture.mjs";

export const requiredIds = ["CT01", "CT02", "CT03", "CT04", "CT05", "CT06", "CT07", "CT08"];

const EXPECTED_NAMES = ["artifacts", "continuity", "fabric", "local", "mcp", "memory", "probe", "repo", "review", "state"];

const sorted = (values) => [...values].sort();
const effective = (requirements) => ({
  verifiedWorkspace: requirements?.verifiedWorkspace === true,
  settlement: requirements?.settlement === true,
});

/** Fresh private roots and a runtime option set for one matrix. */
function runtimeOptions(context, label, { bounds, config, fovea = false }) {
  const base = privateDir(context.fixturesRoot, "matrix-" + label);
  const workspace = privateDir(base, "workspace");
  const locks = privateDir(base, "locks");
  const artifactsRoot = privateDir(base, "artifacts");
  const mcpConfigPath = path.join(base, "mcp.json");
  fs.writeFileSync(mcpConfigPath, "{\"mcpServers\":{},\"imports\":[]}\n", { mode: 0o600 });
  const options = {
    cwd: workspace,
    configFile: path.join(base, "config.json"),
    mcpConfigPath,
    artifactsRoot,
    probesRoot: privateDir(base, "probes"),
    config,
  };
  if (bounds) {
    options.workspaceRoot = workspace;
    options.localLockRoot = locks;
    options.memoryRoot = privateDir(base, "memory");
    options.stateRoot = privateDir(base, "state");
    options.continuityRoot = privateDir(base, "continuity");
  }
  if (fovea) {
    options.foveaClient = { rootId: "w7-root", observer: {}, invoke: async () => null, close: async () => {} };
  }
  return { options, workspace, base };
}

const MATRICES = [
  {
    id: "default",
    bounds: false,
    fovea: false,
    config: {},
    available: ["artifacts", "fabric", "mcp"],
    unavailableReason: {
      local: /verified workspace binding/u, review: /verified workspace binding/u, probe: /verified workspace binding/u,
      repo: /verified workspace and persistent host binding/u, memory: /workspace binding is required/u,
      state: /workspace binding is required/u, continuity: /disabled by configuration/u,
    },
  },
  {
    id: "all-bound",
    bounds: true,
    fovea: true,
    config: { mcp: { enabled: true }, memory: { enabled: true }, state: { enabled: true }, continuity: { enabled: true } },
    available: EXPECTED_NAMES,
    unavailableReason: {},
  },
  {
    id: "all-disabled",
    bounds: false,
    fovea: false,
    config: { mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false }, continuity: { enabled: false } },
    available: ["artifacts", "fabric"],
    unavailableReason: {
      local: /verified workspace binding/u, review: /verified workspace binding/u, probe: /verified workspace binding/u,
      repo: /verified workspace and persistent host binding/u, mcp: /disabled by configuration/u,
      memory: /disabled by configuration/u, state: /disabled by configuration/u, continuity: /disabled by configuration/u,
    },
  },
  {
    id: "bound-no-fovea",
    bounds: true,
    fovea: false,
    config: { mcp: { enabled: true }, memory: { enabled: true }, state: { enabled: true }, continuity: { enabled: true } },
    available: EXPECTED_NAMES.filter((name) => name !== "repo"),
    unavailableReason: { repo: /verified workspace and persistent host binding/u },
  },
  {
    id: "unbound-enabled",
    bounds: false,
    fovea: false,
    config: { mcp: { enabled: true }, memory: { enabled: true }, state: { enabled: true }, continuity: { enabled: true } },
    available: ["artifacts", "fabric", "mcp"],
    unavailableReason: {
      local: /verified workspace binding/u, review: /verified workspace binding/u, probe: /verified workspace binding/u,
      repo: /verified workspace and persistent host binding/u, memory: /workspace binding is required/u,
      state: /workspace binding is required/u, continuity: /verified workspace binding/u,
    },
  },
];

export function createCases() {
  return [
    {
      id: "CT01",
      title: "documented current provider inventory is a frozen exact 10-name set",
      effects: "loads bundled source constant only",
      deadlineMs: 60000,
      run: async (context) => {
        const inventory = await loadW7Inventory(context);
        const list = inventory.FABRIC_RUNTIME_PROVIDER_INVENTORY;
        assert.ok(Array.isArray(list), "inventory export must be an array");
        assert.deepEqual(sorted(list.map((entry) => entry.name)), EXPECTED_NAMES, "inventory names must be exactly the current runtime names");
        assert.equal(new Set(list.map((entry) => entry.name)).size, list.length, "inventory names must be unique");
        assert.ok(Object.isFrozen(list), "inventory array must be frozen");
        for (const entry of list) {
          assert.ok(Object.isFrozen(entry), "inventory entry must be frozen: " + entry.name);
          assert.ok(Object.isFrozen(entry.requirements), "inventory requirements must be frozen: " + entry.name);
          assert.equal(typeof entry.description, "string");
          assert.ok(entry.description.length > 0);
        }
        assert.deepEqual(sorted(inventory.FABRIC_RUNTIME_PROVIDER_NAMES), EXPECTED_NAMES);
        assert.deepEqual(Object.keys(inventory.FABRIC_RUNTIME_PROVIDER_REQUIREMENTS).sort(), EXPECTED_NAMES);
        return {
          status: "passed",
          variants: { names: list.length, frozen: true, unique: true },
          names: list.map((entry) => entry.name),
          coverageGaps: [],
        };
      },
    },
    {
      id: "CT02",
      title: "each provider's explicit requirements metadata matches the documented inventory",
      effects: "constructs real provider classes with private fixture roots; inert Navigator stub",
      deadlineMs: 120000,
      run: async (context) => {
        const api = await loadW7Core(context);
        const inventory = await loadW7Inventory(context);
        const byName = new Map(inventory.FABRIC_RUNTIME_PROVIDER_INVENTORY.map((entry) => [entry.name, entry.requirements]));
        const base = privateDir(context.fixturesRoot, "metadata");
        const workspace = privateDir(base, "workspace");
        const locks = privateDir(base, "locks");
        const config = api.normalizeFabricConfig({ continuity: { enabled: true } });
        const observed = {
          memory: new api.KiroMemoryProvider({ cwd: workspace, root: privateDir(base, "memory"), maxEntries: 1, maxValueChars: 1000 }).requirements ?? {},
          state: new api.StateProvider(privateDir(base, "state"), config.state).requirements ?? {},
          review: new api.ReviewProvider({ root: workspace, maxResultChars: 4000 }).requirements ?? {},
          probe: new api.ProbeProvider({ root: workspace, probesRoot: privateDir(base, "probes"), maxResultChars: 4000 }).requirements ?? {},
          continuity: new api.ContinuityProvider(privateDir(base, "continuity"), { maxTasks: 1, maxTaskBytes: 4096, maxTotalBytes: 4096, maxSummaryBytes: 1024, workspaceRoot: workspace }).requirements ?? {},
          mcp: new api.KiroMcpProvider(workspace, config.mcp).requirements ?? {},
          local: new api.LocalCodingProvider({ root: workspace, lockRoot: locks, maxResultChars: 4000, maxReadManyChars: 4000 }).requirements ?? {},
          repo: new api.FoveaProvider({ rootId: "w7-root", observer: {}, invoke: async () => null, close: async () => {} }).requirements ?? {},
        };
        const mismatches = [];
        for (const [name, requirements] of Object.entries(observed)) {
          if (JSON.stringify(requirements) !== JSON.stringify(byName.get(name))) {
            mismatches.push(name + ": expected=" + JSON.stringify(byName.get(name)) + " actual=" + JSON.stringify(requirements));
          }
        }
        assert.deepEqual(mismatches, [], "provider metadata must match the documented inventory");
        for (const name of ["fabric", "artifacts"]) {
          assert.deepEqual(byName.get(name), {}, name + " must carry no requirement metadata");
        }
        return {
          status: "passed",
          variants: { checked: Object.keys(observed).length, fabricArtifactsEmpty: 2 },
          observed,
          coverageGaps: [],
        };
      },
    },
    {
      id: "CT03",
      title: "runtime registered+unavailable names and effective policy equal the inventory under every gate",
      effects: "constructs real runtimes with private fixture roots; inert Navigator stub; no provider calls",
      deadlineMs: 240000,
      run: async (context) => {
        const api = await loadW7Core(context);
        const inventory = await loadW7Inventory(context);
        const expectedPolicy = new Map(inventory.FABRIC_RUNTIME_PROVIDER_INVENTORY.map((entry) => [entry.name, effective(entry.requirements)]));
        const observations = [];
        for (const matrix of MATRICES) {
          const { options } = runtimeOptions(context, matrix.id, {
            bounds: matrix.bounds,
            fovea: matrix.fovea,
            config: api.normalizeFabricConfig(matrix.config),
          });
          const runtime = api.createKiroRuntime(options);
          try {
            const statuses = runtime.providers();
            assert.deepEqual(sorted(statuses.map((status) => status.name)), EXPECTED_NAMES, "matrix " + matrix.id + " name set");
            const policyMismatches = [];
            for (const status of statuses) {
              const actual = runtime.registry.requirements(status.name + ".probe");
              // Inventory describes registered implementations. Preserve the
              // pre-existing empty fallback for an unavailable repo provider;
              // do not change authorization policy merely to match a table.
              const expected = status.name === "repo" && !status.available
                ? {} : expectedPolicy.get(status.name);
              if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                policyMismatches.push(status.name + ": expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
              }
            }
            assert.deepEqual(policyMismatches, [], "matrix " + matrix.id + " effective policy");
            const available = statuses.filter((status) => status.available).map((status) => status.name);
            assert.deepEqual(sorted(available), sorted(matrix.available), "matrix " + matrix.id + " availability");
            for (const [name, pattern] of Object.entries(matrix.unavailableReason)) {
              const status = statuses.find((entry) => entry.name === name);
              assert.equal(status?.available, false, "matrix " + matrix.id + " " + name + " must be unavailable");
              assert.match(String(status?.reason), pattern, "matrix " + matrix.id + " " + name + " reason");
            }
            observations.push({ matrix: matrix.id, names: statuses.length, available, unavailable: statuses.filter((s) => !s.available).map((s) => s.name) });
          } finally {
            await runtime.close();
          }
        }
        return { status: "passed", variants: { matrices: MATRICES.length, providersPerMatrix: EXPECTED_NAMES.length }, observations, coverageGaps: [] };
      },
    },
    {
      id: "CT04",
      title: "disabled and unavailable providers retain built-in policy and cannot grant availability",
      effects: "constructs one real runtime with private fixture roots",
      deadlineMs: 120000,
      run: async (context) => {
        const api = await loadW7Core(context);
        const inventory = await loadW7Inventory(context);
        const expectedPolicy = new Map(inventory.FABRIC_RUNTIME_PROVIDER_INVENTORY.map((entry) => [entry.name, effective(entry.requirements)]));
        const { options } = runtimeOptions(context, "disabled-policy", {
          bounds: false,
          fovea: false,
          config: api.normalizeFabricConfig({ mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false }, continuity: { enabled: false } }),
        });
        const runtime = api.createKiroRuntime(options);
        try {
          const disabled = ["mcp", "memory", "state", "continuity"];
          const statuses = runtime.providers();
          for (const name of disabled) {
            const status = statuses.find((entry) => entry.name === name);
            assert.equal(status?.available, false, name + " must be unavailable when disabled");
            assert.match(String(status?.reason), /disabled by configuration/u);
            assert.deepEqual(runtime.registry.requirements(name + ".action"), expectedPolicy.get(name), name + " policy must survive being disabled");
            assert.equal(runtime.registry.has(name), false, name + " must not be mounted");
          }
          return { status: "passed", variants: { disabled: disabled.length, policyRetained: true }, disabled, coverageGaps: [] };
        } finally { await runtime.close(); }
      },
    },
    {
      id: "CT05",
      title: "explicitly false provider metadata cannot weaken built-in policy; unknown providers stay empty",
      effects: "fresh in-memory ActionRegistry only",
      deadlineMs: 60000,
      run: async (context) => {
        const api = await loadW7Core(context);
        const registry = new api.ActionRegistry();
        const register = (name, requirements) => registry.register({
          name, description: "w7 fixture " + name, requirements,
          list: async () => [], describe: async () => undefined, invoke: async () => null,
        });
        register("review", { verifiedWorkspace: false, settlement: false });
        register("state", { verifiedWorkspace: false });
        register("mcp", { settlement: false });
        assert.deepEqual(registry.requirements("review.action"), { verifiedWorkspace: true, settlement: true }, "review fallback must survive false metadata");
        assert.deepEqual(registry.requirements("state.action"), { verifiedWorkspace: true, settlement: false }, "state verifiedWorkspace fallback must survive false metadata");
        assert.deepEqual(registry.requirements("mcp.action"), { verifiedWorkspace: false, settlement: true }, "mcp settlement fallback must survive false metadata");
        assert.deepEqual(registry.requirements("unknown.action"), {}, "unregistered unknown provider must confer no requirements");
        const remote = registry.requirements(api.remoteRef("w7-server", "w7-tool"));
        assert.deepEqual(remote, { verifiedWorkspace: false, settlement: true }, "remote refs must inherit mcp policy");
        return { status: "passed", variants: { weakened: 0, unknownEmpty: true, remotePolicy: remote }, coverageGaps: [] };
      },
    },
    {
      id: "CT06",
      title: "unknown configuration sections/fields cannot add authorization and fail closed when file-backed",
      effects: "writes private fixture config files only",
      deadlineMs: 60000,
      run: async (context) => {
        const api = await loadW7Core(context);
        const programmatic = api.normalizeFabricConfig({
          providerInventory: { memory: { verifiedWorkspace: false } },
          memory: { enabled: true, verifiedWorkspace: false },
        });
        assert.equal(Object.hasOwn(programmatic, "providerInventory"), false, "unknown programmatic section must be dropped");
        assert.equal(Object.hasOwn(programmatic.memory, "verifiedWorkspace"), false, "unknown programmatic field must be dropped");
        const base = privateDir(context.fixturesRoot, "config");
        const writeConfig = (name, value) => {
          const file = path.join(base, name);
          fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
          return file;
        };
        let sectionError;
        try { api.loadFabricConfig(writeConfig("bad-section.json", { schemaVersion: 1, providerInventory: {} })); }
        catch (error) { sectionError = String(error.message); }
        assert.match(String(sectionError), /unknown configuration section: providerInventory/u);
        let fieldError;
        try { api.loadFabricConfig(writeConfig("bad-field.json", { schemaVersion: 1, memory: { enabled: true, verifiedWorkspace: false } })); }
        catch (error) { fieldError = String(error.message); }
        assert.match(String(fieldError), /unknown configuration field: memory\.verifiedWorkspace/u);
        return { status: "passed", variants: { programmaticDropped: 2, fileSectionsRejected: 1, fileFieldsRejected: 1 }, sectionError, fieldError, coverageGaps: [] };
      },
    },
    {
      id: "CT07",
      title: "historical agent-product hash admission is unchanged and unknown product hashes are rejected",
      effects: "reads agent-product.json bytes; writes synthetic private package trees; real validator only, no install",
      deadlineMs: 60000,
      run: async (context) => {
        const sourceProduct = path.join(context.root, "agent-product.json");
        const productBytes = fs.readFileSync(sourceProduct);
        const expectedDigest = createHash("sha256").update(productBytes).digest("hex");
        assert.match(expectedDigest, /^[a-f0-9]{64}$/u);
        const minimalPackage = Buffer.from(JSON.stringify({
          name: "kiro-fabric", version: "0.0.0", type: "module", private: true,
          engines: { node: ">=24" }, scripts: { "install:agent": "node scripts/install-agent-user.mjs ." },
        }));
        const build = (label, bytes) => {
          const root = privateDir(context.fixturesRoot, "package-" + label);
          for (const directory of ["runtime", "scripts", "skills", "skills/fabric-exec"]) {
            fs.mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 });
            fs.chmodSync(path.join(root, directory), 0o700);
          }
          fs.writeFileSync(path.join(root, "agent-product.json"), bytes, { mode: 0o600 });
          fs.writeFileSync(path.join(root, "package.json"), minimalPackage, { mode: 0o600 });
          for (const name of ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"]) {
            fs.writeFileSync(path.join(root, "scripts", name), "export {};\n", { mode: 0o600 });
          }
          fs.chmodSync(root, 0o700);
          return root;
        };
        let historicalError = null;
        try { validateAgentPackage(build("historical", productBytes)); }
        catch (error) { historicalError = String(error.message); }
        assert.ok(historicalError !== null, "synthetic package must not fully validate");
        assert.doesNotMatch(historicalError, /agent product authority digest drifted/u, "the historical product bytes must pass the pinned hash gate");
        assert.match(historicalError, /skill inventory drifted/u, "admission must proceed past all product identity checks");
        const tampered = Buffer.concat([productBytes, Buffer.from(" ")]);
        let tamperedError = null;
        try { validateAgentPackage(build("tampered", tampered)); }
        catch (error) { tamperedError = String(error.message); }
        assert.match(String(tamperedError), /agent product authority digest drifted/u, "an unknown product hash must be rejected");
        return {
          status: "passed",
          variants: { historicalHashAdmitted: true, unknownHashRejected: true },
          productDigest: expectedDigest,
          historicalError,
          tamperedError,
          coverageGaps: [],
        };
      },
    },
    {
      id: "CT08",
      title: "additive public declarations: exact source/built inventory and semantic root type imports",
      effects: "bundles src/index.ts and runs a TypeScript semantic check over a private probe",
      deadlineMs: 300000,
      run: async (context) => {
        const api = await loadW7Index(context);
        const list = api.FABRIC_RUNTIME_PROVIDER_INVENTORY;
        assert.ok(Array.isArray(list), "src/index.ts must export FABRIC_RUNTIME_PROVIDER_INVENTORY");
        assert.deepEqual(sorted(list.map((entry) => entry.name)), EXPECTED_NAMES, "public inventory names");
        assert.deepEqual(sorted(api.FABRIC_RUNTIME_PROVIDER_NAMES), EXPECTED_NAMES);
        assert.deepEqual(Object.keys(api.FABRIC_RUNTIME_PROVIDER_REQUIREMENTS).sort(), EXPECTED_NAMES);
        const typeCheck = await checkRootTypeExport(context);
        assert.deepEqual(typeCheck.diagnostics, [], "src/index.ts must export the FabricProviderRequirements type");
        assert.equal(typeCheck.ok, true);
        const built = await verifyBuiltInventory(context.root, list);
        const builtTypeCheck = await checkRootTypeExport(context, "dist");
        assert.deepEqual(builtTypeCheck.diagnostics, [], "dist/index.d.ts must resolve the public requirements type");
        assert.equal(builtTypeCheck.ok, true);
        return {
          status: "passed",
          variants: { runtimeExports: 3, rootTypeExport: true, builtDeclarationCheck: true },
          typeCheck, builtTypeCheck, built,
          coverageGaps: [],
        };
      },
    },
  ];
}
