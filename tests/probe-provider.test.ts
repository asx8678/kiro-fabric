import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricRegistryInvocationContext } from "../src/core/action-registry.js";
import { normalizeFabricConfig } from "../src/config.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { ProbeProvider, ProbeRunExitError } from "../src/providers/probe-provider.js";
import { PROBE_ACTION_DESCRIPTORS, PROBE_GUEST_DECLARATIONS } from "../src/providers/probe-contract.js";
import type { ProbeDiscoveryResult, ProbeHandle, ProbeProviderOptions, ProbeRunResult, ProbeWriteResult } from "../src/providers/probe-contract.js";
import { FabricDeadline } from "../src/runtime/deadline.js";
import { schemaValidationMessage } from "../src/schema-validation.js";
import { fabricJsonText } from "../src/runtime/json-budget.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";

const providers: ProbeProvider[] = [];
// Intentionally retain these uniquely owned temp fixtures too: tests never delete
// the shared tree, fixtures, or production probe data.
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await Promise.all(providers.splice(0).map(provider => provider.close()));
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function fixture(options: Partial<ProbeProviderOptions> = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-probe-test-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root, { mode: 0o700 });
  const probesRoot = path.join(base, "retained");
  const provider = new ProbeProvider({ root, probesRoot, ...options }); providers.push(provider);
  const registry = new ActionRegistry(); registry.register(provider);
  const context = (approve: FabricRegistryInvocationContext["approve"] = async () => {}): FabricRegistryInvocationContext => ({ cwd: "/caller-cwd-never-used", maxResultChars: options.maxResultChars ?? 20000, audits: [], approve });
  const call = (name: string, args: Record<string, unknown>, ctx = context()) => registry.invoke(`probe.${name}`, args, ctx);
  const create = (args: Record<string, unknown> = {}) => call("create", { kind: "illustrative", ...args }) as Promise<ProbeHandle>;
  const records = (handle: ProbeHandle) => path.join(path.dirname(handle.cwd), "records");
  return { base, root, probesRoot, provider, registry, context, call, create, records };
}
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const waitForFile = async (file: string) => {
  for (let i = 0; i < 300; i++) { if (fs.existsSync(file)) return; await delay(10); }
  throw new Error("shell start marker never appeared");
};

// Fixture approvals are not evidence about real Kiro client permissions.
describe("ProbeProvider public and approval contracts", () => {
  it("exports closed JSON-tree descriptors and checked JSON-compatible guest methods", async () => {
    const f = fixture();
    const descriptors = await f.provider.list();
    expect(descriptors.map(item => item.name)).toEqual(["discover", "create", "write", "run"]);
    expect(PROBE_ACTION_DESCRIPTORS.map(item => item.name)).toEqual(descriptors.map(item => item.name));
    expect(() => fabricJsonText(descriptors)).not.toThrow();
    for (const descriptor of descriptors) {
      expect(descriptor.inputSchema.additionalProperties).toBe(false);
      expect(descriptor.outputSchema?.additionalProperties).toBe(false);
      expect(PROBE_GUEST_DECLARATIONS).toContain(`${descriptor.name}(`);
      expect(await f.provider.describe(descriptor.name)).toEqual(descriptor);
    }
    expect(await f.provider.describe("delete")).toBeUndefined();
    expect((await f.provider.describe("run"))?.risk).toBe("execute");
    expect((await f.provider.describe("run"))?.effect).toEqual({ kind: "write", resources: ["*"] });
    expect((await f.provider.describe("create"))?.risk).toBe("write");
    expect((await f.provider.describe("discover"))?.risk).toBe("read");
    descriptors[0]!.description = "forged";
    expect((await f.provider.describe("discover"))?.description).not.toBe("forged");
    const declarations = fabricGuestDeclarations.includes("type ProbeKind =") ? fabricGuestDeclarations : fabricGuestDeclarations + PROBE_GUEST_DECLARATIONS;
    for (const code of ['return await probe.discover({executables:["dotnet"]});', 'return await probe.create({kind:"framework-semantic",files:[{path:"a.cs",content:"x"}]});', 'return await probe.write({id:"x",path:"a",content:"x"});', 'return await probe.run({id:"x",script:"exit 7",settle:true});', 'return await probe.run({id:"x",executable:"dotnet",args:["--version"]});']) {
      expect(typeCheckFabricCode(code, declarations).errors, code).toEqual([]);
    }
    for (const code of ['return await probe.run({id:"x",script:"true",cwd:"/tmp"});', 'return await probe.create({kind:"production-proof"});', 'return await probe.run({id:"x",script:"true",executable:"sh"});', 'return await probe.write({id:"x",path:"a",content:"x",overwrite:true});']) {
      expect(typeCheckFabricCode(code, declarations).errors.length, code).toBeGreaterThan(0);
    }
  });

  it("constructor, preparation, reservation and denied create cause zero filesystem effects", async () => {
    const f = fixture();
    const args = { kind: "repository-code", files: [{ path: "src/test.cs", content: "caller supplied independent example" }] };
    expect(fs.existsSync(f.probesRoot)).toBe(false);
    const prepared = await f.provider.prepareArguments("create", args, f.context());
    expect(schemaValidationMessage((await f.provider.describe("create"))!.inputSchema, prepared)).toBeUndefined();
    const release = await f.provider.reserveInvocation("create", prepared, f.context());
    expect(fs.existsSync(f.probesRoot)).toBe(false); release();
    const deny = vi.fn(async () => { expect(fs.existsSync(f.probesRoot)).toBe(false); throw new Error("fixture denied"); });
    await expect(f.call("create", args, f.context(deny))).rejects.toThrow("fixture denied");
    expect(deny).toHaveBeenCalledOnce(); expect(fs.readdirSync(f.base)).toEqual(["workspace"]);
    const approved = await f.create(); expect(fs.existsSync(approved.manifestPath)).toBe(true);
  });

  it("creates independent retained projects without copying the repository or executing files", async () => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "production.txt"), "original");
    const a = await f.create({ label: "same", files: [{ path: "src/test.sh", content: "touch forbidden\n" }] });
    const b = await f.create({ label: "same", kind: "framework-semantic" });
    expect(a.id).not.toBe(b.id); expect(a.cwd).not.toBe(b.cwd);
    expect(fs.readFileSync(path.join(a.cwd, "src/test.sh"), "utf8")).toBe("touch forbidden\n");
    expect(fs.readdirSync(b.cwd)).toEqual([]);
    expect(fs.existsSync(path.join(a.cwd, "forbidden"))).toBe(false);
    expect(fs.existsSync(path.join(a.cwd, "production.txt"))).toBe(false);
    expect(fs.readdirSync(f.root)).toEqual(["production.txt"]);
    expect(a).toMatchObject({ kind: "illustrative", retained: true, productionProof: false });
    expect(readJson(a.manifestPath)).toMatchObject({ schemaVersion: 1, declarations: { status: "caller-declared-unverified" } });
    expect(fs.statSync(f.probesRoot).mode & 0o777).toBe(0o700);
    await f.provider.close();
    expect(fs.existsSync(a.manifestPath)).toBe(true); expect(fs.existsSync(b.manifestPath)).toBe(true);
  });

  it("requires separate exact write approval and ignores approver argument tampering", async () => {
    const f = fixture(); const h = await f.create(); const before = fs.readdirSync(f.records(h));
    await expect(f.call("write", { id: h.id, path: "new/file.txt", content: "approved" }, f.context(async () => { throw new Error("denied write"); }))).rejects.toThrow("denied write");
    expect(fs.readdirSync(h.cwd)).toEqual([]); expect(fs.readdirSync(f.records(h))).toEqual(before);
    const result = await f.call("write", { id: h.id, path: "new/file.txt", content: "approved" }, f.context(async (action, args) => {
      expect(action.risk).toBe("write"); expect(args.content).toBe("approved");
      expect(args._probePreparation).toMatchObject({ id: h.id, cwd: h.cwd });
      expect(fs.readdirSync(h.cwd)).toEqual([]);
      args.content = "forged"; args.path = "../../escape";
    })) as ProbeWriteResult;
    expect(fs.readFileSync(path.join(h.cwd, "new/file.txt"), "utf8")).toBe("approved");
    expect(readJson(result.recordPath)).toEqual(result);
    expect(schemaValidationMessage((await f.provider.describe("write"))!.outputSchema!, result)).toBeUndefined();
    await expect(f.call("write", { id: h.id, path: "new/file.txt", content: "overwrite" })).rejects.toThrow(/create-only/);
  });

  it("denies a real execution-service tool call before records or shell effects", async () => {
    const f = fixture(); const h = await f.create(); const before = fs.readdirSync(f.records(h));
    const service = new FabricExecutionService(f.registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), f.root);
    const approve = vi.fn(async () => { throw new Error("denied fixture execution"); });
    try {
      const result = await service.execute({ code: `return await tools.call({ref:"probe.run",args:{id:${JSON.stringify(h.id)},script:"touch forbidden",settle:true}});`, approver: { approve } });
      expect(result.success, result.error).toBe(false);
      expect(approve).toHaveBeenCalledOnce();
      expect(result.audits[0]).toMatchObject({ ref: "probe.run", success: false });
      expect(fs.existsSync(path.join(h.cwd, "forbidden"))).toBe(false);
      expect(fs.readdirSync(f.records(h))).toEqual(before);
    } finally { await service.close(); }
  });
});

describe("ProbeProvider executed evidence", () => {
  it("retains actual independent ordinary failure results and never quietly reruns", async () => {
    const f = fixture(); const h = await f.create({ kind: "repository-code" });
    const args = { id: h.id, script: 'printf out; printf err >&2; printf x >> attempts; exit 7' };
    const failure = await f.call("run", args).catch(error => error);
    expect(failure).toBeInstanceOf(ProbeRunExitError);
    if (!(failure instanceof ProbeRunExitError)) throw new Error("Expected retained ordinary failure evidence");
    expect(failure.result).toMatchObject({ ok: false, exitCode: 7, signal: null, stdout: "out", stderr: "err", kind: "repository-code", productionProof: false });
    expect(readJson(failure.result.recordPath).result).toEqual(failure.result);
    const second = await f.call("run", { ...args, settle: true }) as ProbeRunResult;
    expect(second.runId).not.toBe(failure.result.runId);
    expect(second).toMatchObject({ ok: false, exitCode: 7 });
    expect(fs.readFileSync(path.join(h.cwd, "attempts"), "utf8")).toBe("xx");
    expect(fs.readdirSync(f.records(h)).filter(name => name.startsWith("run-") && name.endsWith(".result.json"))).toHaveLength(2);
    expect(schemaValidationMessage((await f.provider.describe("run"))!.outputSchema!, second)).toBeUndefined();
  });

  it("execs direct executable argv literally with true exit status and owned cwd", async () => {
    const f = fixture(); const h = await f.create();
    const literal = "spaces ' quote $(touch forbidden) ; false\n雪";
    const args = ["-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),arg:process.argv[1]}));process.exit(19)", literal];
    const result = await f.call("run", { id: h.id, executable: process.execPath, args, settle: true }, f.context(async (_action, prepared) => {
      expect(prepared.executable).toBe(process.execPath); expect(prepared.args).toEqual(args);
      expect(prepared._probePreparation).toMatchObject({ cwd: h.cwd });
    })) as ProbeRunResult;
    expect(result.exitCode).toBe(19); expect(result.ok).toBe(false);
    expect(JSON.parse(result.stdout)).toEqual({ cwd: h.cwd, arg: literal });
    expect(fs.existsSync(path.join(h.cwd, "forbidden"))).toBe(false);
    expect(readJson(result.recordPath.replace(".result.json", ".request.json")).executedInput).toEqual({ script: 'exec "$@"', interpreter: "sh", args: [process.execPath, ...args] });
  });

  it("reports literal pipeline last exit honestly and keeps declarations separate from observation", async () => {
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "do-not-forward"); vi.stubEnv("PROBE_DECLARED_ONLY", undefined);
    const f = fixture(); const h = await f.create({ kind: "framework-semantic", declarations: { sdkVersions: [{ name: "dotnet", version: "declared-not-observed" }], sourceReferences: [{ path: "src/production.cs", sha256: "a".repeat(64) }] } });
    const result = await f.call("run", { id: h.id, script: 'printf "%s" "$1"; test -z "$PROBE_DECLARED_ONLY" || exit 41; test -z "$AWS_SECRET_ACCESS_KEY" || exit 42; false | true', args: ["$literal"], declarations: { packageVersions: [{ name: "example", version: "unverified" }], environment: [{ name: "PROBE_DECLARED_ONLY", value: "not-applied" }] } }) as ProbeRunResult;
    expect(result).toMatchObject({ ok: true, exitCode: 0, stdout: "$literal", productionProof: false });
    const request = readJson(result.recordPath.replace(".result.json", ".request.json"));
    expect(request.declarations.status).toBe("caller-declared-unverified");
    expect(request.declarations.project.sdkVersions[0].version).toBe("declared-not-observed");
    expect(request.declarations.run.environment[0].value).toBe("not-applied");
    expect(request.environment.observed).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(request.environment.observed).not.toHaveProperty("PROBE_DECLARED_ONLY");
    expect(request.versionObservation).toContain("No version detection performed");
    expect(request.semantics).toContain("last status");
  });

  it("bounds escaped stdout/stderr with explicit retained truncation", async () => {
    const f = fixture({ maxResultChars: 1024 }); const h = await f.create();
    const result = await f.call("run", { id: h.id, executable: process.execPath, args: ["-e", 'process.stdout.write("\\u0001".repeat(10000));process.stderr.write("x".repeat(10000))'] }) as ProbeRunResult;
    expect(result).toMatchObject({ ok: true, truncated: true, stdoutTruncated: true, stderrTruncated: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
    expect(readJson(result.recordPath).result).toEqual(result);
  });
});

describe("ProbeProvider bounded presence discovery", () => {
  it("finds off-PATH SDKs and cache existence without executing even an unusable candidate", async () => {
    const f = fixture({ discoveryEnvironment: { PATH: "/no-such-probe-bin" } });
    const home = path.join(f.base, "home"); fs.mkdirSync(path.join(home, ".dotnet"), { recursive: true });
    fs.mkdirSync(path.join(home, ".nuget/packages"), { recursive: true });
    const dotnet = path.join(home, ".dotnet/dotnet");
    const executionMarker = path.join(home, "must-not-execute");
    fs.writeFileSync(dotnet, `#!/bin/sh\nprintf ran > '${executionMarker}'\nexit 99\n`, { mode: 0o700 });
    fs.writeFileSync(path.join(home, ".nuget/packages", "secret-cache-content"), "do not read");
    const provider = new ProbeProvider({ root: f.root, probesRoot: f.probesRoot, discoveryEnvironment: { HOME: home, PATH: "/no-such-probe-bin" } }); providers.push(provider);
    const registry = new ActionRegistry(); registry.register(provider);
    const result = await registry.invoke("probe.discover", { executables: ["dotnet", "not-present-123"] }, f.context()) as ProbeDiscoveryResult;
    expect(result).toMatchObject({ executed: false, versionsObserved: false, credentialsAssumed: false });
    expect(result.executables).toContainEqual({ name: "dotnet", path: dotnet, source: "conventional-sdk", exists: true, executableFile: true });
    expect(result.caches).toContainEqual({ path: path.join(home, ".nuget/packages"), exists: true });
    expect(JSON.stringify(result)).not.toContain("secret-cache-content");
    expect(fs.existsSync(executionMarker)).toBe(false);
    expect(fs.existsSync(f.probesRoot)).toBe(false);
    expect(schemaValidationMessage((await provider.describe("discover"))!.outputSchema!, result)).toBeUndefined();
  });

  it("bounds PATH work and output, excludes relative PATH, and validates executable names", async () => {
    const dirs = Array.from({ length: 70 }, (_, i) => `/not-present-sdk-${i}`);
    const f = fixture({ maxResultChars: 1024, discoveryEnvironment: { PATH: [".", "", ...dirs].join(path.delimiter) } });
    const result = await f.call("discover", { executables: Array.from({ length: 16 }, (_, i) => `missing${i}`) }) as ProbeDiscoveryResult;
    expect(result.truncated).toBe(true); expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
    expect(result.executables.every(item => path.isAbsolute(item.path))).toBe(true);
    expect(result.executables.some(item => item.path.includes("sdk-31/"))).toBe(false);
    const approve = vi.fn(async () => {});
    await expect(f.call("discover", { executables: ["../sh"] }, f.context(approve))).rejects.toThrow(/Invalid/);
    expect(approve).not.toHaveBeenCalled(); expect(fs.existsSync(f.probesRoot)).toBe(false);
  });
});

describe("ProbeProvider owned identities and quotas", () => {
  it("rejects caller cwd, injected metadata, unsafe file paths, IDs and executable alternatives before approval", async () => {
    const f = fixture(); const h = await f.create(); const approve = vi.fn(async () => {});
    const ctx = f.context(approve);
    for (const name of ["../escape", "/tmp/escape", "a/../../escape", "a\\escape", "a//x", ".", "a/./b"]) {
      await expect(f.call("write", { id: h.id, path: name, content: "bad" }, ctx)).rejects.toThrow(/safe relative/);
    }
    for (const args of [{ id: h.id, script: "true", cwd: f.root }, { id: h.id, script: "true", _probePreparation: {} }, { id: h.id, script: "true", executable: "sh" }, { id: h.id, executable: "-sh" }, { id: h.id, script: "true\0" }, { id: randomUUID(), script: "true" }]) {
      await expect(f.call("run", args, ctx)).rejects.toThrow();
    }
    await expect(f.call("create", { kind: "illustrative", files: [{ path: "a", content: "" }, { path: "a/b", content: "" }] }, ctx)).rejects.toThrow(/overlap/);
    expect(approve).not.toHaveBeenCalled(); expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it.each(["symlink", "hardlink"] as const)("refuses %s files and leaves outside content untouched", async mode => {
    const f = fixture(); const h = await f.create(); const outside = path.join(f.root, "untouched"); fs.writeFileSync(outside, "original");
    if (mode === "symlink") fs.symlinkSync(outside, path.join(h.cwd, "linked")); else fs.linkSync(outside, path.join(h.cwd, "linked"));
    await expect(f.call("write", { id: h.id, path: "linked", content: "bad" })).rejects.toThrow(/create-only/);
    fs.symlinkSync(f.root, path.join(h.cwd, "external"));
    await expect(f.call("write", { id: h.id, path: "external/escape", content: "bad" })).rejects.toThrow(/symlink|host-owned/);
    expect(fs.readFileSync(outside, "utf8")).toBe("original"); expect(fs.existsSync(path.join(f.root, "escape"))).toBe(false);
  });

  it("rejects a foreign retained result inserted during approval before shell launch", async () => {
    const f = fixture(); const h = await f.create();
    const outside = path.join(f.root, "original"); fs.writeFileSync(outside, "unchanged");
    await expect(f.call("run", { id: h.id, script: "touch forbidden" }, f.context(async (_action, args) => {
      const metadata = args._probePreparation as { recordPath: string };
      fs.symlinkSync(outside, metadata.recordPath);
    }))).rejects.toThrow(/create-only/);
    expect(fs.existsSync(path.join(h.cwd, "forbidden"))).toBe(false);
    expect(fs.readFileSync(outside, "utf8")).toBe("unchanged");
    expect(fs.readdirSync(f.records(h)).filter(name => name.endsWith(".request.json"))).toEqual([]);
  });

  it("never follows a records symlink substituted by an approved host shell", async () => {
    const f = fixture(); const h = await f.create();
    await expect(f.call("run", { id: h.id, script: 'mv ../records ../records-original; ln -s "$1" ../records', args: [f.root] })).rejects.toThrow(/retention/);
    expect(fs.readdirSync(f.root)).toEqual([]);
    const original = path.join(path.dirname(h.cwd), "records-original");
    expect(fs.readdirSync(original).filter(name => name.endsWith(".request.json"))).toHaveLength(1);
    await expect(f.call("run", { id: h.id, script: "true" })).rejects.toThrow(/uncertain/);
  });

  it("rejects directory replacement during approval before records or execution", async () => {
    const f = fixture(); const h = await f.create(); const before = fs.readdirSync(f.records(h));
    await expect(f.call("run", { id: h.id, script: "touch forbidden" }, f.context(async () => {
      fs.renameSync(h.cwd, h.cwd + ".retained-original"); fs.symlinkSync(f.root, h.cwd);
    }))).rejects.toThrow(/symlink|identity/);
    expect(fs.existsSync(path.join(f.root, "forbidden"))).toBe(false);
    expect(fs.readdirSync(f.records(h))).toEqual(before);
  });

  it("rejects unsafe root ancestry, replacement, and repository overlap with zero provider writes", async () => {
    const f = fixture();
    for (const target of [f.root, path.join(f.root, "probes"), f.base]) expect(() => new ProbeProvider({ root: f.root, probesRoot: target })).toThrow(/outside/);
    fs.symlinkSync(f.base, path.join(f.base, "alias"));
    expect(() => new ProbeProvider({ root: f.root, probesRoot: path.join(f.base, "alias", "new") })).toThrow(/symlink/);
    fs.mkdirSync(path.join(f.base, "public"), { mode: 0o755 });
    expect(() => new ProbeProvider({ root: f.root, probesRoot: path.join(f.base, "public") })).toThrow(/private/);
    await expect(f.call("create", { kind: "illustrative" }, f.context(async () => { fs.symlinkSync(f.root, f.probesRoot); }))).rejects.toThrow(/replaced/);
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it("does not adopt another instance's retained IDs and enforces retained directory/write/run quotas", async () => {
    const f = fixture({ maxProbes: 1, maxWritesPerProbe: 1, maxRunsPerProbe: 1 }); const h = await f.create();
    await f.call("write", { id: h.id, path: "one", content: "one" });
    await expect(f.call("write", { id: h.id, path: "two", content: "two" })).rejects.toThrow(/quota/);
    await f.call("run", { id: h.id, script: "true" });
    await expect(f.call("run", { id: h.id, script: "true" })).rejects.toThrow(/quota/);
    await expect(f.create()).rejects.toThrow(/quota/);
    const other = new ProbeProvider({ root: f.root, probesRoot: f.probesRoot, maxProbes: 1 }); providers.push(other);
    await expect(other.prepareArguments("run", { id: h.id, script: "true" }, f.context())).rejects.toThrow(/not owned/);
    await expect(other.prepareArguments("create", { kind: "illustrative" }, f.context())).rejects.toThrow(/quota/);
    expect(fs.existsSync(h.manifestPath)).toBe(true);
  });

  it("rejects oversized managed content, arguments and tiny result budgets before approval", async () => {
    const f = fixture({ maxManagedBytesPerProbe: 65536 }); const approve = vi.fn(async () => {});
    await expect(f.call("create", { kind: "illustrative", files: [{ path: "a", content: "x".repeat(32768) }] }, f.context(approve))).rejects.toThrow(/quota/);
    await expect(f.call("create", { kind: "illustrative", files: [{ path: "a", content: "x".repeat(32769) }] }, f.context(approve))).rejects.toThrow(/Invalid/);
    await expect(f.call("create", { kind: "illustrative" }, { ...f.context(approve), maxResultChars: 256 })).rejects.toThrow(/maxResultChars/);
    expect(approve).not.toHaveBeenCalled(); expect(fs.existsSync(f.probesRoot)).toBe(false);
  });
});

describe("ProbeProvider cancellation and close", () => {
  it.each(["cancel", "timeout", "deadline", "close"] as const)("never settles %s, awaits process cleanup and retains honest unavailable evidence", async mode => {
    const f = fixture(); const h = await f.create(); const controller = new AbortController();
    const ctx = { ...f.context(), signal: controller.signal, ...(mode === "deadline" ? { deadline: new FabricDeadline(180, 180) } : {}) };
    const pending = f.call("run", { id: h.id, script: 'echo $$ > started.pid; sleep 30', settle: true, timeoutMs: mode === "timeout" ? 180 : 30000 }, ctx).catch(error => error as Error);
    await waitForFile(path.join(h.cwd, "started.pid"));
    const pid = Number(fs.readFileSync(path.join(h.cwd, "started.pid"), "utf8"));
    if (mode === "cancel") controller.abort(new Error("fixture abort"));
    if (mode === "close") await f.provider.close();
    const failure = await pending;
    expect(failure).toBeInstanceOf(Error); expect(failure).not.toBeInstanceOf(ProbeRunExitError);
    expect((failure as Error).message).toMatch(/cancelled|timed out|expired|closed/);
    expect(() => process.kill(pid, 0)).toThrow();
    const results = fs.readdirSync(f.records(h)).filter(name => name.startsWith("run-") && name.endsWith(".result.json"));
    expect(results).toHaveLength(1);
    expect(readJson(path.join(f.records(h), results[0]!))).toMatchObject({ status: "hard-failure", result: null, evidenceUnavailable: true, productionProof: false });
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it("never settles abnormal signal exits", async () => {
    const f = fixture(); const h = await f.create();
    await expect(f.call("run", { id: h.id, script: "kill -TERM $$", settle: true })).rejects.toThrow(/abnormally/);
    const resultFile = fs.readdirSync(f.records(h)).find(name => name.startsWith("run-") && name.endsWith(".result.json"))!;
    expect(readJson(path.join(f.records(h), resultFile))).toMatchObject({ status: "hard-failure", evidenceUnavailable: true });
  });

  it("keeps memory reservations through pending approval close and never starts a late effect", async () => {
    const f = fixture(); const entered = deferred(); const approved = deferred();
    const pending = f.call("create", { kind: "illustrative" }, f.context(async () => { entered.resolve(); await approved.promise; })).catch(error => error as Error);
    await entered.promise; await f.provider.close();
    const other = new ProbeProvider({ root: f.root, probesRoot: f.probesRoot }); providers.push(other);
    const registry = new ActionRegistry(); registry.register(other);
    await expect(registry.invoke("probe.create", { kind: "illustrative" }, f.context())).rejects.toThrow(/overlapping/);
    expect(fs.existsSync(f.probesRoot)).toBe(false);
    approved.resolve(); expect(await pending).toBeInstanceOf(Error);
    expect(fs.existsSync(f.probesRoot)).toBe(false);
    expect(await registry.invoke("probe.create", { kind: "illustrative" }, f.context())).toMatchObject({ retained: true });
  });
});
