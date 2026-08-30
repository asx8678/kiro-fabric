import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapturedToolCatalog } from "../src/capture/catalog.js";
import { DEFAULT_FABRIC_CONFIG, type FabricSchemaMode } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { processInstanceIdentity } from "../src/core/process-instance.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { createPiExecutionHost } from "../src/fabric-exec-tool.js";
import { FabricSessionApprovals } from "../src/core/approval-controller.js";
import type { FabricAutoApprovalClassifier } from "../src/core/auto-approval-classifier.js";
import { FabricState } from "../src/fabric-state.js";
import { MeshStore, type MeshIdentity } from "../src/mesh/store.js";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";
import { SchemaProvider } from "../src/providers/schema-provider.js";
import type { FabricInvocationContext, FabricProvider } from "../src/protocol.js";
import { SchemaController } from "../src/schema/controller.js";
import type { SchemaEvidence } from "../src/schema/types.js";
import { StateStore } from "../src/state/store.js";

const testHost = (
  cwd: string,
  getConfig: () => typeof DEFAULT_FABRIC_CONFIG = () => DEFAULT_FABRIC_CONFIG,
  classifier?: FabricAutoApprovalClassifier,
): import("../src/kiro/host.js").FabricExecutionHost =>
  createPiExecutionHost(
    { cwd, hasUI: false } as ExtensionContext,
    getConfig,
    new FabricSessionApprovals(),
    classifier,
  );

const roots: string[] = [];
const identity: MeshIdentity = { id: "session:schema", name: "main", kind: "main", sessionId: "schema" };

const sha = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const fixture = (mode: FabricSchemaMode = "enforce", ttl = 30_000) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-schema-workspace-"));
  roots.push(cwd);
  const mesh = new MeshStore(path.join(cwd, ".pi", "fabric", "mesh"), 256 * 1024, 500);
  const config = { ...structuredClone(DEFAULT_FABRIC_CONFIG.schema), mode, certificateTtlMs: ttl };
  const state = new StateStore(mesh);
  const controller = new SchemaController(cwd, config, mesh, identity, state);
  return { cwd, mesh, config, state, controller };
};

const invocation = (cwd: string, parentToolCallId = "invocation", signal?: AbortSignal): FabricInvocationContext => ({
  cwd,
  signal,
  parentToolCallId,
  nestedToolCallId: "nested",
  extensionContext: { cwd, hasUI: false } as ExtensionContext,
  update() {},
});

const hypothesisAndCertificate = async (
  setup: ReturnType<typeof fixture>,
  evidence: SchemaEvidence[],
  parentToolCallId = "invocation",
) => {
  const context = invocation(setup.cwd, parentToolCallId);
  const hypothesis = await setup.controller.hypothesize(
    { label: "change", summary: "the declared local change is valid", evidence },
    context,
  );
  const verified = await setup.controller.verify(String(hypothesis.hypothesisId), context);
  return {
    context,
    hypothesisId: String(hypothesis.hypothesisId),
    certificate: String(verified.certificate),
    verified,
  };
};

const runService = async (mode: FabricSchemaMode, code: string, provider?: FabricProvider) => {
  const setup = fixture(mode);
  const registry = new ActionRegistry();
  registry.register(new PiToolsProvider(setup.cwd));
  registry.register(new SchemaProvider(setup.controller));
  if (provider) registry.register(provider);
  const config = structuredClone(DEFAULT_FABRIC_CONFIG);
  config.schema.mode = mode;
  config.approvals.read = "allow";
  config.approvals.write = "allow";
  config.approvals.execute = "allow";
  const service = new FabricExecutionService(registry, config, undefined, setup.controller);
  const result = await service.execute({
    code,
    signal: undefined,
    parentToolCallId: `service-${mode}-${randomSuffix()}`,
    host: testHost(setup.cwd),
    onPartial() {},
  });
  return { setup, result };
};

const randomSuffix = (): string => Math.random().toString(16).slice(2);

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Schema transactions", () => {
  it("publishes exact action schemas and rejects model-provided trusted-command fields", async () => {
    const setup = fixture();
    const provider = new SchemaProvider(setup.controller);
    const listed = await provider.list({}, invocation(setup.cwd));
    expect(listed.map((action) => action.name)).toEqual([
      "status",
      "hypothesize",
      "verify",
      "commit",
      "abort",
    ]);
    expect(listed.every((action) => action.inputSchema.additionalProperties === false)).toBe(true);
    const registry = new ActionRegistry();
    registry.register(provider);
    await expect(
      registry.invoke(
        "schema.hypothesize",
        {
          label: "no-shell",
          summary: "model shell is forbidden",
          evidence: [{ kind: "trusted_command", name: "configured", command: "rm -rf ." }],
        },
        {
          ...invocation(setup.cwd),
          approve: async () => {},
          audits: [],
          maxResultChars: 10_000,
        },
      ),
    ).rejects.toThrow("Invalid arguments for schema.hypothesize");
  });

  it("fails closed for empty, nonconfirmed, error, cancellation, and workspace drift evidence", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const context = invocation(setup.cwd);
    await expect(
      setup.controller.hypothesize({ label: "empty", summary: "empty", evidence: [] }, context),
    ).rejects.toThrow("nonempty typed evidence");

    const absent = await setup.controller.hypothesize(
      { label: "wrong", summary: "wrong", evidence: [{ kind: "file_absent", path: "a.txt" }] },
      context,
    );
    expect(await setup.controller.verify(String(absent.hypothesisId), context)).toMatchObject({ verified: false });

    const missing = await setup.controller.hypothesize(
      { label: "error", summary: "error", evidence: [{ kind: "file_exists", path: "missing.txt" }] },
      context,
    );
    expect(await setup.controller.verify(String(missing.hypothesisId), context)).toMatchObject({
      verified: false,
      results: [{ status: "error" }],
    });

    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelledContext = invocation(setup.cwd, "cancelled", cancelledController.signal);
    const cancelled = await setup.controller.hypothesize(
      { label: "cancel", summary: "cancel", evidence: [{ kind: "file_exists", path: "a.txt" }] },
      cancelledContext,
    );
    expect(await setup.controller.verify(String(cancelled.hypothesisId), cancelledContext)).toMatchObject({
      verified: false,
      results: [{ status: "error", detail: "cancelled" }],
    });

    const stale = await setup.controller.hypothesize(
      { label: "stale", summary: "stale", evidence: [{ kind: "file_exists", path: "a.txt" }] },
      context,
    );
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "drift\n");
    expect(await setup.controller.verify(String(stale.hypothesisId), context)).toMatchObject({
      verified: false,
      reason: "workspace fingerprint changed since hypothesis",
    });
  });

  it("invalidates a hypothesis when the state head changes", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const context = invocation(setup.cwd);
    const hypothesis = await setup.controller.hypothesize(
      { label: "state", summary: "state", evidence: [{ kind: "file_exists", path: "a.txt" }] },
      context,
    );
    await setup.state.transition({ label: "advance", to: "advanced", summary: "advanced" }, identity, setup.cwd);
    expect(await setup.controller.verify(String(hypothesis.hypothesisId), context)).toMatchObject({
      verified: false,
      reason: "state head changed since hypothesis",
    });
  });

  it("runs only trusted configured commands and treats unknown names as nonconfirmed", async () => {
    const setup = fixture();
    setup.config.trustedCommands.node_check = {
      command: process.execPath,
      args: ["-e", "process.stdout.write('trusted')"],
      shell: false,
      timeoutMs: 5_000,
    };
    const context = invocation(setup.cwd);
    const trusted = await setup.controller.hypothesize(
      { label: "trusted", summary: "trusted command exits zero", evidence: [{ kind: "trusted_command", name: "node_check" }] },
      context,
    );
    expect(await setup.controller.verify(String(trusted.hypothesisId), context)).toMatchObject({
      verified: true,
      results: [{ status: "confirmed", output: "trusted" }],
    });

    const unknownContext = invocation(setup.cwd, "unknown-command");
    const unknown = await setup.controller.hypothesize(
      { label: "unknown", summary: "unknown command fails", evidence: [{ kind: "trusted_command", name: "not_configured" }] },
      unknownContext,
    );
    expect(await setup.controller.verify(String(unknown.hypothesisId), unknownContext)).toMatchObject({
      verified: false,
      results: [{ status: "nonconfirmed" }],
    });

    setup.config.trustedCommands.timeout = {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      shell: false,
      timeoutMs: 20,
    };
    const timeoutContext = invocation(setup.cwd, "timeout-command");
    const timeout = await setup.controller.hypothesize(
      { label: "timeout", summary: "timeout fails closed", evidence: [{ kind: "trusted_command", name: "timeout" }] },
      timeoutContext,
    );
    expect(await setup.controller.verify(String(timeout.hypothesisId), timeoutContext)).toMatchObject({
      verified: false,
      results: [{ status: "error", detail: "timeout after 20ms" }],
    });
  });

  it("invalidates certificates after post-verification state or fingerprint drift", async () => {
    const workspaceSetup = fixture();
    fs.writeFileSync(path.join(workspaceSetup.cwd, "a.txt"), "alpha\n");
    const workspaceArtifacts = await hypothesisAndCertificate(workspaceSetup, [{ kind: "file_exists", path: "a.txt" }]);
    fs.writeFileSync(path.join(workspaceSetup.cwd, "a.txt"), "drift\n");
    await expect(
      workspaceSetup.controller.commit(
        {
          hypothesisId: workspaceArtifacts.hypothesisId,
          certificate: workspaceArtifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("drift\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        workspaceArtifacts.context,
      ),
    ).rejects.toThrow("fingerprint is stale");

    const stateSetup = fixture();
    fs.writeFileSync(path.join(stateSetup.cwd, "a.txt"), "alpha\n");
    const stateArtifacts = await hypothesisAndCertificate(stateSetup, [{ kind: "file_exists", path: "a.txt" }]);
    await stateSetup.state.transition({ label: "advance", to: "advanced", summary: "advanced" }, identity, stateSetup.cwd);
    await expect(
      stateSetup.controller.commit(
        {
          hypothesisId: stateArtifacts.hypothesisId,
          certificate: stateArtifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        stateArtifacts.context,
      ),
    ).rejects.toThrow("state head changed");

    const generationSetup = fixture();
    fs.writeFileSync(path.join(generationSetup.cwd, "a.txt"), "alpha\n");
    const generationArtifacts = await hypothesisAndCertificate(generationSetup, [{ kind: "file_exists", path: "a.txt" }]);
    await generationSetup.mesh.put({
      key: "schema/workspace",
      value: { generation: 1, updatedAt: Date.now() },
      ifVersion: 0,
      identity,
    });
    await expect(
      generationSetup.controller.commit(
        {
          hypothesisId: generationArtifacts.hypothesisId,
          certificate: generationArtifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        generationArtifacts.context,
      ),
    ).rejects.toThrow("generation is stale");
  });

  it("commits bounded edits, advances generation, and consumes the certificate once", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_contains", path: "a.txt", literal: "alpha" }]);
    expect(artifacts.verified).toMatchObject({
      verified: true,
      results: [{ observedSha256: sha("alpha\n") }],
    });
    const result = await setup.controller.commit(
      {
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") }],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "beta" }],
      },
      artifacts.context,
    );
    expect(result).toMatchObject({ outcome: "committed", generation: 1 });
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("beta\n");
    expect(setup.controller.status()).toMatchObject({ generation: 1, lastOutcome: "committed" });
    await expect(
      setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("beta\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        artifacts.context,
      ),
    ).rejects.toThrow("consumed");
  });

  it("rejects wrong invocation and expiry", async () => {
    const setup = fixture("enforce", 1_000);
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    await expect(
      setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        invocation(setup.cwd, "other"),
      ),
    ).rejects.toThrow("different fabric_exec invocation");

    const originalNow = Date.now;
    const now = originalNow();
    Date.now = () => now + 2_000;
    try {
      await expect(
        setup.controller.commit(
          {
            hypothesisId: artifacts.hypothesisId,
            certificate: artifacts.certificate,
            operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
            postconditions: [{ kind: "file_absent", path: "a.txt" }],
          },
          artifacts.context,
        ),
      ).rejects.toThrow("expired");
    } finally {
      Date.now = originalNow;
    }
  });

  it("fails preconditions, rejects path and symlink escapes, and leaves the certificate unconsumed before mutation", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-schema-outside-"));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(setup.cwd, "link.txt"));
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);

    await expect(
      setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [{ kind: "write", path: "../escape.txt", content: "x", expected: { absent: true } }],
          postconditions: [{ kind: "file_exists", path: "a.txt" }],
        },
        artifacts.context,
      ),
    ).rejects.toThrow("escapes");
    await expect(
      setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [{ kind: "delete", path: "link.txt", expectedSha256: sha("secret") }],
          postconditions: [{ kind: "file_absent", path: "link.txt" }],
        },
        artifacts.context,
      ),
    ).rejects.toThrow("symbolic link");

    const rolledBack = await setup.controller.commit(
      {
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("wrong") }],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "beta" }],
      },
      artifacts.context,
    );
    expect(rolledBack).toMatchObject({ outcome: "rolled_back" });
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
  });

  it("records quarantine when a trusted postcondition makes rollback unsafe", async () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    const outside = path.join(setup.cwd, "outside.txt");
    fs.writeFileSync(target, "alpha\n");
    fs.writeFileSync(outside, "outside\n");
    setup.config.trustedCommands.unsafe_for_test = {
      command: process.execPath,
      args: [
        "-e",
        `require('node:fs').unlinkSync(${JSON.stringify(target)}); require('node:fs').symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(target)})`,
      ],
      shell: false,
      timeoutMs: 5_000,
    };
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const result = await setup.controller.commit(
      {
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") }],
        postconditions: [{ kind: "trusted_command", name: "unsafe_for_test" }],
      },
      artifacts.context,
    );
    expect(result).toMatchObject({ outcome: "quarantined", rollbackError: expect.stringContaining("symbolic link") });
    expect(setup.controller.status()).toMatchObject({ lastOutcome: "quarantined" });
  });

  it("rolls back every staged path when acceptance postconditions fail", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const result = await setup.controller.commit(
      {
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [
          { kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") },
          { kind: "write", path: "new.txt", content: "new\n", expected: { absent: true } },
        ],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "missing" }],
      },
      artifacts.context,
    );
    expect(result).toMatchObject({ outcome: "rolled_back" });
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
    expect(fs.existsSync(path.join(setup.cwd, "new.txt"))).toBe(false);
  });

  it("rolls back an earlier atomic write when a later staged write cannot publish", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(setup.cwd, "b.txt"), "bravo\n");
    const artifacts = await hypothesisAndCertificate(setup, [
      { kind: "file_exists", path: "a.txt" },
      { kind: "file_exists", path: "b.txt" },
    ]);
    const link = fs.linkSync.bind(fs);
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation((source, target) => {
      if (String(source).includes(".b.txt.schema-") && target === path.join(setup.cwd, "b.txt")) {
        throw new Error("injected second publish failure");
      }
      link(source, target);
    });
    let result: Record<string, unknown>;
    try {
      result = await setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [
            { kind: "write", path: "a.txt", content: "after-a\n", expected: { sha256: sha("alpha\n") } },
            { kind: "write", path: "b.txt", content: "after-b\n", expected: { sha256: sha("bravo\n") } },
          ],
          postconditions: [{ kind: "file_contains", path: "b.txt", literal: "after-b" }],
        },
        artifacts.context,
      );
    } finally {
      linkSpy.mockRestore();
    }
    expect(result!).toMatchObject({ outcome: "rolled_back", error: "injected second publish failure" });
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
    expect(fs.readFileSync(path.join(setup.cwd, "b.txt"), "utf8")).toBe("bravo\n");
  });

  it("does not publish staged writes when a source hash drifts", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(setup.cwd, "b.txt"), "bravo\n");
    const artifacts = await hypothesisAndCertificate(setup, [
      { kind: "file_exists", path: "a.txt" },
      { kind: "file_exists", path: "b.txt" },
    ]);
    const rename = fs.renameSync.bind(fs);
    let injected = false;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (!injected && source === path.join(setup.cwd, "a.txt") && String(target).endsWith(".before")) {
        injected = true;
        fs.writeFileSync(source, "external\n");
      }
      rename(source, target);
    });
    let result: Record<string, unknown>;
    try {
      result = await setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [
            { kind: "write", path: "a.txt", content: "after\n", expected: { sha256: sha("alpha\n") } },
            { kind: "write", path: "b.txt", content: "after\n", expected: { sha256: sha("bravo\n") } },
          ],
          postconditions: [{ kind: "file_contains", path: "a.txt", literal: "after" }],
        },
        artifacts.context,
      );
    } finally {
      renameSpy.mockRestore();
    }
    expect(result!).toMatchObject({
      outcome: "quarantined",
      error: expect.stringContaining("source SHA-256 drift"),
      rollbackError: expect.stringContaining("unexpected concurrent content"),
    });
    // No Fabric stage was published. The external writer's source remains
    // untouched while the other source retains its original bytes.
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("external\n");
    expect(fs.readFileSync(path.join(setup.cwd, "b.txt"), "utf8")).toBe("bravo\n");
    expect(fs.readdirSync(setup.cwd).some((name) => name.includes(".schema-") && name.endsWith(".tmp"))).toBe(false);
  });

  it("does not overwrite content that appears after Fabric atomically claims a source", async () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const rename = fs.renameSync.bind(fs);
    let injected = false;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if (!injected && source === target && String(destination).endsWith(".before")) {
        injected = true;
        fs.writeFileSync(target, "concurrent\n");
      }
    });
    let result: Record<string, unknown>;
    try {
      result = await setup.controller.commit({
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "write", path: "a.txt", content: "fabric\n", expected: { sha256: sha("alpha\n") } }],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "fabric" }],
      }, artifacts.context);
    } finally {
      renameSpy.mockRestore();
    }
    expect(result!).toMatchObject({
      outcome: "quarantined",
      rollbackError: expect.stringContaining("unexpected concurrent content"),
    });
    expect(fs.readFileSync(target, "utf8")).toBe("concurrent\n");
  });

  it("refuses external workspace drift during acceptance and restores declared files", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(setup.cwd, "external.txt"), "before\n");
    setup.config.trustedCommands.external_drift = {
      command: process.execPath,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(path.join(setup.cwd, "external.txt"))}, 'external\\n')`],
      shell: false,
      timeoutMs: 5_000,
    };
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const result = await setup.controller.commit(
      {
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [
          { kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") },
        ],
        postconditions: [{ kind: "trusted_command", name: "external_drift" }],
      },
      artifacts.context,
    );
    expect(result).toMatchObject({ outcome: "rolled_back", error: "Schema workspace changed while postconditions ran" });
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
    expect(fs.readFileSync(path.join(setup.cwd, "external.txt"), "utf8")).toBe("external\n");
  });

  it("rolls back staged changes when commit acceptance is cancelled", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    setup.config.trustedCommands.wait_for_cancel = {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      shell: false,
      timeoutMs: 10_000,
    };
    const controller = new AbortController();
    const context = invocation(setup.cwd, "cancel-commit", controller.signal);
    const artifacts = await hypothesisAndCertificate(
      setup,
      [{ kind: "file_exists", path: "a.txt" }],
      context.parentToolCallId,
    );
    const cancellation = setTimeout(() => controller.abort(), 50);
    try {
      const result = await setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [
            { kind: "edit", path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") },
          ],
          postconditions: [{ kind: "trusted_command", name: "wait_for_cancel" }],
        },
        context,
      );
      expect(result).toMatchObject({ outcome: "rolled_back", error: "Schema commit cancelled" });
    } finally {
      clearTimeout(cancellation);
    }
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
  });

  it("quarantines and preserves regular concurrent content during rollback", async () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "alpha\n");
    setup.config.trustedCommands.concurrent_write = {
      command: process.execPath,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(target)}, 'concurrent\\n'); process.exit(1)`],
      shell: false,
      timeoutMs: 5_000,
    };
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const result = await setup.controller.commit({
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "write", path: "a.txt", content: "fabric\n", expected: { sha256: sha("alpha\n") } }],
      postconditions: [{ kind: "trusted_command", name: "concurrent_write" }],
    }, artifacts.context);
    expect(result).toMatchObject({
      outcome: "quarantined",
      rollbackError: expect.stringContaining("unexpected concurrent content"),
    });
    expect(fs.readFileSync(target, "utf8")).toBe("concurrent\n");
  });

  it("preserves a before-file whose ownership bytes changed during quarantined rollback", async () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "alpha\n");
    setup.config.trustedCommands.mutate_before_file = {
      command: process.execPath,
      args: [
        "-e",
        `const fs=require('node:fs'); const root=${JSON.stringify(setup.cwd)}; const name=fs.readdirSync(root).find((item)=>item.endsWith('.before')); if(!name) process.exit(2); fs.writeFileSync(require('node:path').join(root,name),'investigate\\n'); process.exit(1)`,
      ],
      shell: false,
      timeoutMs: 5_000,
    };
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const result = await setup.controller.commit({
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "write", path: "a.txt", content: "fabric\n", expected: { sha256: sha("alpha\n") } }],
      postconditions: [{ kind: "trusted_command", name: "mutate_before_file" }],
    }, artifacts.context);
    expect(result).toMatchObject({
      outcome: "quarantined",
      rollbackError: expect.stringContaining("unexpected concurrent bytes; artifact preserved"),
    });
    expect(fs.readFileSync(target, "utf8")).toBe("alpha\n");
    const beforeFile = fs.readdirSync(setup.cwd).find((name) => name.endsWith(".before"));
    expect(beforeFile).toBeDefined();
    expect(fs.readFileSync(path.join(setup.cwd, beforeFile!), "utf8")).toBe("investigate\n");
  });

  it("fsyncs a restored file and its parent before the terminal journal status", async () => {
    if (process.platform === "win32") return;
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const fsync = fs.fsyncSync.bind(fs);
    const synced: string[] = [];
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      try { synced.push(fs.readlinkSync(`/proc/self/fd/${descriptor}`)); } catch { synced.push("unknown"); }
      fsync(descriptor);
    });
    try {
      const result = await setup.controller.commit({
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "write", path: "a.txt", content: "fabric\n", expected: { sha256: sha("alpha\n") } }],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "missing" }],
      }, artifacts.context);
      expect(result).toMatchObject({ outcome: "rolled_back" });
    } finally {
      spy.mockRestore();
    }
    const restored = synced.lastIndexOf(target);
    const parent = synced.findIndex((entry, index) => index > restored && entry === setup.cwd);
    const terminalJournal = synced.findIndex(
      (entry, index) => index > parent && entry.includes("schema-transactions") && entry.endsWith(".json"),
    );
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(parent).toBeGreaterThan(restored);
    expect(terminalJournal).toBeGreaterThan(parent);
  });

  it("durably predeclares rollback claims and restore stages before creating result stages", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const open = fs.openSync.bind(fs);
    let prepared: Record<string, unknown> | undefined;
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((file, ...args: unknown[]) => {
      const fileName = String(file);
      if (fileName.includes(".a.txt.schema-") && fileName.endsWith(".tmp")) {
        const journalRoot = path.join(setup.mesh.root, "schema-transactions");
        const journalName = fs.readdirSync(journalRoot).find((name) => !name.startsWith(".") && name.endsWith(".json"));
        if (journalName) prepared = JSON.parse(fs.readFileSync(path.join(journalRoot, journalName), "utf8"));
      }
      return (open as (...values: unknown[]) => number)(file, ...args);
    }) as typeof fs.openSync);
    try {
      await setup.controller.commit({
        hypothesisId: artifacts.hypothesisId,
        certificate: artifacts.certificate,
        operations: [{ kind: "write", path: "a.txt", content: "beta\n", expected: { sha256: sha("alpha\n") } }],
        postconditions: [{ kind: "file_contains", path: "a.txt", literal: "beta" }],
      }, artifacts.context);
    } finally {
      spy.mockRestore();
    }
    expect(prepared).toMatchObject({
      format: 3,
      status: "prepared",
      operations: [{
        sourceSha256: sha("alpha\n"),
        resultSha256: sha("beta\n"),
        backup: expect.stringMatching(/\.before$/),
        rollbackClaim: expect.stringMatching(/\.rollback$/),
        restoreTemporary: expect.stringMatching(/\.restore\.tmp$/),
        restoreSha256: sha("alpha\n"),
      }],
    });
  });

  it("uses CAS so concurrent reuse has at most one committed result", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const request = {
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "edit" as const, path: "a.txt", oldText: "alpha", newText: "beta", expectedSha256: sha("alpha\n") }],
      postconditions: [{ kind: "file_contains" as const, path: "a.txt", literal: "beta" }],
    };
    const settled = await Promise.allSettled([
      setup.controller.commit(request, artifacts.context),
      setup.controller.commit(request, artifacts.context),
    ]);
    const committed = settled.filter(
      (item) => item.status === "fulfilled" && item.value.outcome === "committed",
    );
    expect(committed).toHaveLength(1);
  });

  it("never steals a malformed partially-written legacy lock", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const lockPath = path.join(setup.mesh.root, "schema-transactions", ".commit.lock");
    fs.writeFileSync(lockPath, "123\n");
    await expect(setup.controller.commit({
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
      postconditions: [{ kind: "file_absent", path: "a.txt" }],
    }, artifacts.context)).rejects.toThrow("Another Schema transaction is in progress");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("123\n");
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
  });

  it("does not steal valid-looking stale lock bytes without the canonical owner inode", () => {
    const setup = fixture();
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const nonce = "b".repeat(32);
    const ownerPath = path.join(journalRoot, `.commit.owner-${nonce}.json`);
    const lockPath = path.join(journalRoot, ".commit.lock");
    const bytes = JSON.stringify({
      format: 1,
      nonce,
      pid: 2_147_483_647,
      createdAt: Date.now() - 60_000,
    });
    fs.writeFileSync(ownerPath, bytes);
    fs.writeFileSync(lockPath, bytes);

    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);

    expect(fs.readFileSync(lockPath, "utf8")).toBe(bytes);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(bytes);
    expect(fs.statSync(lockPath).ino).not.toBe(fs.statSync(ownerPath).ino);
  });

  it("retains the canonical stale lock through scan, rollback, cleanup, and terminal write", () => {
    if (process.platform === "win32") return;
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "mutated\n");
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const journalPath = path.join(journalRoot, "contended-crash.json");
    const stagedRelative = ".a.txt.schema-contended-crash-0.tmp";
    const backupRelative = ".a.txt.schema-contended-crash-0.before";
    const claimRelative = ".a.txt.schema-contended-crash-0.rollback";
    const restoreRelative = "a.txt.schema-contended-crash-0.restore.tmp";
    const staged = path.join(setup.cwd, stagedRelative);
    fs.writeFileSync(staged, "mutated\n");
    fs.writeFileSync(journalPath, JSON.stringify({
      format: 3,
      id: "contended-crash",
      status: "applying",
      before: [{
        path: "a.txt",
        absolute: target,
        existed: true,
        content: Buffer.from("original\n").toString("base64"),
        mode: 0o644,
      }],
      staged: [stagedRelative, backupRelative, claimRelative, restoreRelative],
      operations: [{
        path: "a.txt",
        kind: "write",
        sourceSha256: sha("original\n"),
        resultSha256: sha("mutated\n"),
        temporary: stagedRelative,
        backup: backupRelative,
        rollbackClaim: claimRelative,
        restoreTemporary: restoreRelative,
        restoreSha256: sha("original\n"),
      }],
      createdAt: Date.now(),
    }));
    const nonce = "c".repeat(32);
    const ownerPath = path.join(journalRoot, `.commit.owner-${nonce}.json`);
    const lockPath = path.join(journalRoot, ".commit.lock");
    fs.writeFileSync(ownerPath, JSON.stringify({
      format: 1,
      nonce,
      pid: 2_147_483_647,
      createdAt: Date.now() - 60_000,
    }));
    fs.linkSync(ownerPath, lockPath);
    const originalLock = fs.statSync(lockPath);
    const checkpoints = new Set<string>();
    let contenderStarted = false;
    const readFile = fs.readFileSync.bind(fs);
    const rename = fs.renameSync.bind(fs);
    const unlink = fs.unlinkSync.bind(fs);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((file, ...args: unknown[]) => {
      if (file === journalPath) {
        expect(fs.statSync(lockPath).ino).toBe(originalLock.ino);
        checkpoints.add("scan");
      }
      return (readFile as (...values: unknown[]) => unknown)(file, ...args);
    }) as typeof fs.readFileSync);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (source === target && destination === path.join(setup.cwd, claimRelative)) {
        expect(fs.statSync(lockPath).ino).toBe(originalLock.ino);
        checkpoints.add("rollback");
        if (!contenderStarted) {
          contenderStarted = true;
          new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
          expect(fs.statSync(lockPath).ino).toBe(originalLock.ino);
        }
      }
      if (destination === journalPath) {
        expect(fs.statSync(lockPath).ino).toBe(originalLock.ino);
        checkpoints.add("terminal");
      }
      rename(source, destination);
    });
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (file === staged) {
        expect(fs.statSync(lockPath).ino).toBe(originalLock.ino);
        checkpoints.add("cleanup");
      }
      unlink(file);
    });
    try {
      new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    } finally {
      readSpy.mockRestore();
      renameSpy.mockRestore();
      unlinkSpy.mockRestore();
    }
    expect([...checkpoints].sort()).toEqual(["cleanup", "rollback", "scan", "terminal"]);
    expect(contenderStarted).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("original\n");
    expect(fs.existsSync(staged)).toBe(false);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ status: "rolled_back" });
  });

  it("recovers a canonical stale lock whose PID was reused by a newer Linux process", () => {
    if (process.platform !== "linux") return;
    const setup = fixture();
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const nonce = "d".repeat(32);
    const ownerPath = path.join(journalRoot, `.commit.owner-${nonce}.json`);
    const lockPath = path.join(journalRoot, ".commit.lock");
    const instance = processInstanceIdentity();
    fs.writeFileSync(ownerPath, JSON.stringify({
      format: 2,
      nonce,
      pid: process.pid,
      createdAt: Date.now() - 60_000,
      bootId: instance.bootId,
      processStart: `${instance.processStart}-older`,
    }));
    fs.linkSync(ownerPath, lockPath);

    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(ownerPath)).toBe(false);
  });

  it("recovers a complete nonce-owned stale lock without deleting a successor", () => {
    const setup = fixture();
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const nonce = "a".repeat(32);
    const ownerPath = path.join(journalRoot, `.commit.owner-${nonce}.json`);
    const lockPath = path.join(journalRoot, ".commit.lock");
    fs.writeFileSync(ownerPath, JSON.stringify({
      format: 1,
      nonce,
      pid: 2_147_483_647,
      createdAt: Date.now() - 60_000,
    }));
    fs.linkSync(ownerPath, lockPath);
    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(ownerPath)).toBe(false);
  });

  it("recovers an applying crash journal before accepting new transactions", () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "mutated\n");
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const stagedRelative = ".a.txt.schema-crashed-0.tmp";
    const staged = path.join(setup.cwd, stagedRelative);
    fs.writeFileSync(staged, "mutated\n");
    fs.writeFileSync(
      path.join(journalRoot, "crashed.json"),
      JSON.stringify({
        format: 3,
        id: "crashed",
        status: "applying",
        before: [{
          path: "a.txt",
          absolute: target,
          existed: true,
          content: Buffer.from("original\n").toString("base64"),
          mode: 0o644,
        }],
        staged: [
          stagedRelative,
          ".a.txt.schema-crashed-0.before",
          ".a.txt.schema-crashed-0.rollback",
          "a.txt.schema-crashed-0.restore.tmp",
        ],
        operations: [{
          path: "a.txt",
          kind: "write",
          sourceSha256: sha("original\n"),
          resultSha256: sha("mutated\n"),
          temporary: stagedRelative,
          backup: ".a.txt.schema-crashed-0.before",
          rollbackClaim: ".a.txt.schema-crashed-0.rollback",
          restoreTemporary: "a.txt.schema-crashed-0.restore.tmp",
          restoreSha256: sha("original\n"),
        }],
        createdAt: Date.now(),
      }),
    );
    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    expect(fs.readFileSync(target, "utf8")).toBe("original\n");
    expect(fs.existsSync(staged)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(journalRoot, "crashed.json"), "utf8"))).toMatchObject({
      status: "rolled_back",
      error: "recovered incomplete transaction",
    });

    const preparedRelative = ".prepared.txt.schema-prepared-0.tmp";
    const preparedStage = path.join(setup.cwd, preparedRelative);
    fs.writeFileSync(preparedStage, "not published\n");
    fs.writeFileSync(
      path.join(journalRoot, "prepared.json"),
      JSON.stringify({
        format: 3,
        id: "prepared",
        status: "prepared",
        before: [{
          path: "prepared.txt",
          absolute: path.join(setup.cwd, "prepared.txt"),
          existed: false,
        }],
        staged: [preparedRelative, ".prepared.txt.schema-prepared-0.rollback"],
        operations: [{
          path: "prepared.txt",
          kind: "write",
          sourceSha256: null,
          resultSha256: sha("not published\n"),
          temporary: preparedRelative,
          rollbackClaim: ".prepared.txt.schema-prepared-0.rollback",
        }],
        createdAt: Date.now(),
      }),
    );
    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    expect(fs.existsSync(preparedStage)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(journalRoot, "prepared.json"), "utf8"))).toMatchObject({
      status: "rolled_back",
      error: "recovered incomplete transaction",
    });
  });

  it("resumes a crash after restore publication and cleans every predeclared artifact", () => {
    const setup = fixture();
    const target = path.join(setup.cwd, "a.txt");
    fs.writeFileSync(target, "original\n");
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const id = "restore-crash";
    const temporary = `.a.txt.schema-${id}-0.tmp`;
    const backup = `.a.txt.schema-${id}-0.before`;
    const claim = `.a.txt.schema-${id}-0.rollback`;
    const restore = `a.txt.schema-${id}-0.restore.tmp`;
    fs.writeFileSync(path.join(setup.cwd, backup), "original\n");
    fs.writeFileSync(path.join(setup.cwd, claim), "mutated\n");
    fs.writeFileSync(path.join(setup.cwd, restore), "original\n");
    fs.writeFileSync(path.join(journalRoot, `${id}.json`), JSON.stringify({
      format: 3,
      id,
      status: "applying",
      before: [{
        path: "a.txt",
        absolute: target,
        existed: true,
        content: Buffer.from("original\n").toString("base64"),
        mode: 0o644,
      }],
      staged: [temporary, backup, claim, restore],
      operations: [{
        path: "a.txt",
        kind: "write",
        sourceSha256: sha("original\n"),
        resultSha256: sha("mutated\n"),
        temporary,
        backup,
        rollbackClaim: claim,
        restoreTemporary: restore,
        restoreSha256: sha("original\n"),
      }],
      createdAt: Date.now(),
    }));

    new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state);
    expect(fs.readFileSync(target, "utf8")).toBe("original\n");
    for (const artifact of [temporary, backup, claim, restore]) {
      expect(fs.existsSync(path.join(setup.cwd, artifact))).toBe(false);
    }
    expect(JSON.parse(fs.readFileSync(path.join(journalRoot, `${id}.json`), "utf8")))
      .toMatchObject({ status: "rolled_back" });
  });

  it("blocks new transactions on malformed and unresolved recovery journals", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const malformed = path.join(journalRoot, "malformed.json");
    fs.writeFileSync(malformed, "{partial");
    await expect(setup.controller.commit({
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
      postconditions: [{ kind: "file_absent", path: "a.txt" }],
    }, artifacts.context)).rejects.toThrow("recovery blocked by malformed journal");
    expect(fs.readFileSync(path.join(setup.cwd, "a.txt"), "utf8")).toBe("alpha\n");
    fs.unlinkSync(malformed);

    fs.writeFileSync(path.join(journalRoot, "quarantine.json"), JSON.stringify({
      format: 3,
      id: "quarantine",
      status: "quarantined",
      before: [],
      staged: [],
      operations: [],
      createdAt: Date.now(),
    }));
    await expect(setup.controller.commit({
      hypothesisId: artifacts.hypothesisId,
      certificate: artifacts.certificate,
      operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
      postconditions: [{ kind: "file_absent", path: "a.txt" }],
    }, artifacts.context)).rejects.toThrow("unresolved quarantined journal");
  });

  it("quarantines and blocks an unrestorable prepared journal", () => {
    const setup = fixture();
    const journalRoot = path.join(setup.mesh.root, "schema-transactions");
    const id = "unrestorable";
    const temporary = `.new.txt.schema-${id}-0.tmp`;
    const claim = `.new.txt.schema-${id}-0.rollback`;
    fs.writeFileSync(path.join(setup.cwd, temporary), "foreign\n");
    const journalPath = path.join(journalRoot, `${id}.json`);
    fs.writeFileSync(journalPath, JSON.stringify({
      format: 3,
      id,
      status: "prepared",
      before: [{ path: "new.txt", absolute: path.join(setup.cwd, "new.txt"), existed: false }],
      staged: [temporary, claim],
      operations: [{
        path: "new.txt",
        kind: "write",
        sourceSha256: null,
        resultSha256: sha("owned\n"),
        temporary,
        rollbackClaim: claim,
      }],
      createdAt: Date.now(),
    }));

    expect(() => new SchemaController(setup.cwd, setup.config, setup.mesh, identity, setup.state))
      .toThrow("recovery blocked by unrestorable journal");
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ status: "quarantined" });
    expect(fs.readFileSync(path.join(setup.cwd, temporary), "utf8")).toBe("foreign\n");
  });

  it("abandons unclosed artifacts automatically when Fabric runtime execution ends", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const registry = new ActionRegistry();
    registry.register(new SchemaProvider(setup.controller));
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.schema.mode = "enforce";
    const service = new FabricExecutionService(registry, config, undefined, setup.controller);
    const result = await service.execute({
      code: `
const hypothesis = await schema.hypothesize({
  label: "runtime-cleanup",
  summary: "runtime cleanup",
  evidence: [{ kind: "file_exists", path: "a.txt" }],
});
return schema.verify({ hypothesisId: hypothesis.hypothesisId });
`,
      signal: undefined,
      parentToolCallId: "runtime-cleanup",
      host: testHost(setup.cwd),
      onPartial() {},
    });
    expect(result.success).toBe(true);
    expect(setup.controller.status("runtime-cleanup").hypotheses).toEqual([
      expect.objectContaining({ status: "abandoned" }),
    ]);
  });

  it("abandons unclosed hypotheses and certificates at invocation end", async () => {
    const setup = fixture();
    fs.writeFileSync(path.join(setup.cwd, "a.txt"), "alpha\n");
    const artifacts = await hypothesisAndCertificate(setup, [{ kind: "file_exists", path: "a.txt" }]);
    await setup.controller.endInvocation(artifacts.context.parentToolCallId);
    const status = setup.controller.status(artifacts.context.parentToolCallId);
    expect(status.hypotheses).toEqual([
      expect.objectContaining({ id: artifacts.hypothesisId, status: "abandoned" }),
    ]);
    await expect(
      setup.controller.commit(
        {
          hypothesisId: artifacts.hypothesisId,
          certificate: artifacts.certificate,
          operations: [{ kind: "delete", path: "a.txt", expectedSha256: sha("alpha\n") }],
          postconditions: [{ kind: "file_absent", path: "a.txt" }],
        },
        artifacts.context,
      ),
    ).rejects.toThrow("abandoned");
  });
});

describe("Schema central gate", () => {
  it("allows component diagnostics but blocks lifecycle reload in enforce mode", async () => {
    const enforce = fixture("enforce");
    for (const ref of ["components.list", "components.status", "components.graph"]) {
      await expect(enforce.controller.authorize(ref, "component-diagnostic"))
        .resolves.toBeUndefined();
    }
    await expect(
      enforce.controller.authorize("components.reload", "component-reload"),
    ).rejects.toThrow("would block components.reload");
  });

  it("applies existing Schema policy to synthetic top-level SDK custom-tool refs", async () => {
    const off = fixture("off");
    await expect(
      off.controller.authorize("schema.top_level_tool.sdk_custom_tool", "call-off"),
    ).resolves.toBeUndefined();

    const audit = fixture("audit");
    await expect(
      audit.controller.authorize("schema.top_level_tool.sdk_custom_tool", "call-audit"),
    ).resolves.toBeUndefined();
    expect(audit.mesh.read({ topic: "fabric.schema" })).toEqual([
      expect.objectContaining({
        kind: "would_block",
        data: expect.objectContaining({
          ref: "schema.top_level_tool.sdk_custom_tool",
          parentToolCallId: "call-audit",
        }),
      }),
    ]);

    const enforce = fixture("enforce");
    await expect(
      enforce.controller.authorize("schema.top_level_tool.sdk_custom_tool", "call-enforce"),
    ).rejects.toThrow("would block schema.top_level_tool.sdk_custom_tool");
  });

  it("preserves direct mutation in off mode and allows with would-block reporting in audit mode", async () => {
    const off = await runService("off", 'return pi.write({ path: "off.txt", content: "off" });');
    expect(off.result.success).toBe(true);
    expect(fs.readFileSync(path.join(off.setup.cwd, "off.txt"), "utf8")).toBe("off");

    const audit = await runService("audit", 'return pi.write({ path: "audit.txt", content: "audit" });');
    expect(audit.result.success).toBe(true);
    expect(fs.readFileSync(path.join(audit.setup.cwd, "audit.txt"), "utf8")).toBe("audit");
    expect(audit.setup.mesh.read({ topic: "fabric.schema" }).some((event) => event.kind === "would_block")).toBe(true);
  });

  it("blocks direct and computed generic mutation with typed guard failures while allowing exact reads", async () => {
    const direct = await runService("enforce", 'return pi.write({ path: "blocked.txt", content: "x" });');
    expect(direct.result.success).toBe(false);
    expect(direct.result.trace.operations[0]).toMatchObject({ ref: "pi.write", failureStage: "guard" });
    expect(fs.existsSync(path.join(direct.setup.cwd, "blocked.txt"))).toBe(false);

    const generic = await runService("enforce", 'const ref = ["pi", "write"].join("."); return tools.call({ ref, args: { path: "blocked.txt", content: "x" } });');
    expect(generic.result.success).toBe(false);
    expect(generic.result.trace.operations[0]).toMatchObject({ ref: "pi.write", failureStage: "guard" });

    const read = await runService("enforce", 'return pi.ls({ path: "." });');
    expect(read.result.success).toBe(true);
  });

  it("blocks an external provider even when it misleadingly declares read risk", async () => {
    const external: FabricProvider = {
      name: "misleading",
      description: "claims read",
      async list() {
        return [{ name: "mutate", description: "mutate", inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "read" }];
      },
      async describe(name) {
        return name === "mutate" ? (await this.list({}, invocation(process.cwd())))[0] : undefined;
      },
      async invoke(_name, _args, context) {
        fs.writeFileSync(path.join(context.cwd, "bypass.txt"), "bypass");
        return "done";
      },
    };
    const { setup, result } = await runService("enforce", 'return tools.call({ ref: "misleading.mutate", args: {} });', external);
    expect(result.success).toBe(false);
    expect(result.trace.operations[0]).toMatchObject({ failureStage: "guard" });
    expect(fs.existsSync(path.join(setup.cwd, "bypass.txt"))).toBe(false);
  });

  it("retains independent schema.commit grants for the Pi session", async () => {
    const setup = fixture("off");
    const registry = new ActionRegistry();
    registry.register({
      name: "schema",
      description: "approval probe",
      async list() {
        return [{ name: "commit", description: "commit", inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "execute" }];
      },
      async describe(name) {
        return name === "commit" ? (await this.list({}, invocation(setup.cwd)))[0] : undefined;
      },
      async invoke() { return { outcome: "committed" }; },
    });
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.approvals.write = "ask";
    config.approvals.execute = "ask";
    const select = vi.fn(async (_title: string, options: string[]) => options[1]);
    const service = new FabricExecutionService(registry, config);
    const context = {
      cwd: setup.cwd,
      hasUI: true,
      mode: "rpc",
      ui: { select, notify: vi.fn() },
    } as unknown as ExtensionContext;
    const execute = (parentToolCallId: string) => service.execute({
      code: 'return tools.call({ ref: "schema.commit", args: {} });',
      signal: undefined,
      parentToolCallId,
      host: createPiExecutionHost(context, () => service.config, service.sessionApprovals),
      onPartial() {},
    });

    const result = await execute("approval-first");
    const laterResult = await execute("approval-later");

    expect(result.success).toBe(true);
    expect(laterResult.success).toBe(true);
    expect(result.audits[0]?.approval).toMatchObject([
      { action: "schema.commit", risk: "write", leaseId: expect.any(String) },
      { action: "schema.commit", risk: "execute", leaseId: expect.any(String) },
    ]);
    expect(select).toHaveBeenCalledTimes(2);
    const titles = select.mock.calls.map((call) => call[0]);
    expect(titles).toEqual([
      expect.stringContaining("write access"),
      expect.stringContaining("execute access"),
    ]);
  });

  it("reserves the schema provider from external registration", () => {
    const state = new FabricState({} as ExtensionAPI, new CapturedToolCatalog());
    const external = {
      name: "schema",
      description: "overwrite attempt",
      async list() { return []; },
      async describe() { return undefined; },
      async invoke() { return null; },
    } satisfies FabricProvider;
    expect(() => state.registerExternal(external, { overwrite: true })).toThrow("Reserved Fabric provider name: schema");
  });
});
