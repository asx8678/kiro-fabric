import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EvidenceProvider } from "../src/providers/evidence-provider.js";
import { CommandBroker } from "../src/core/command-broker.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const ctx: FabricInvocationContext = {
  cwd: process.cwd(),
  signal: undefined,
  parentToolCallId: "p",
  nestedToolCallId: "n",
  extensionContext: {} as never,
  update() {},
};

const open = () =>
  new EvidenceProvider({
    evidenceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ev-prov-")),
    sessionId: "test",
  });

describe("EvidenceProvider", () => {
  it("lists its actions", async () => {
    const provider = open();
    const listed = await provider.list({}, ctx);
    expect(listed.map((d) => d.name)).toEqual(
      expect.arrayContaining(["submit", "hypothesize", "support", "falsify", "query", "summary", "run", "evaluate"]),
    );
  });

  it("submit + adjudicate to a capsule", async () => {
    const provider = open();
    const sub = (await provider.invoke("submit", {
      statement: "file is tracked",
      commit: "abc123",
    }, ctx)) as { claimId: string };
    expect(sub.claimId).toMatch(/^claim-/);

    await provider.invoke("hypothesize", { claimId: sub.claimId, by: "a" }, ctx);
    await provider.invoke("support", { claimId: sub.claimId, by: "a" }, ctx);
    const gate = (await provider.invoke("evaluate", {}, ctx)) as { status: string };
    expect(gate.status).toBe("defer"); // supported, not confirmed

    // Move to CONFIRMED through ledger directly is not exposed; falsify instead
    await provider.invoke("falsify", {
      claimId: sub.claimId,
      by: "b",
      counterevidence: [{ ref: "git ls-files missing" }],
    }, ctx);
    const gate2 = (await provider.invoke("evaluate", {}, ctx)) as {
      status: string;
      capsule: { falsifiedIds: string[] };
    };
    expect(gate2.status).toBe("accept");
    expect(gate2.capsule.falsifiedIds).toContain(sub.claimId);
  });

  it("runs a command through the command broker", async () => {
    const provider = open();
    const result = (await provider.invoke("run", {
      command: "node",
      args: ["-e", "console.log('ok')"],
      cwd: process.cwd(),
      commit: "abc",
      treeHash: "th",
    }, ctx)) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });

  it("enforces the trusted-command allowlist and workspace boundary when configured", async () => {
    const provider = new EvidenceProvider({
      evidenceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ev-prov-")),
      sessionId: "test",
      workspaceRoot: process.cwd(),
      trustedCommands: {
        node: { command: "node", args: ["-e", "console.log('ok')"], shell: false, timeoutMs: 10000 },
      },
    });
    const realCommit = CommandBroker.commitHash(process.cwd());
    const realTree = CommandBroker.treeHash(process.cwd());
    // Exact configured command by name is authorized when the workspace identity matches.
    const ok = (await provider.invoke("run", {
      name: "node",
      command: "node",
      args: ["-e", "console.log('ok')"],
      cwd: process.cwd(),
      commit: realCommit,
      treeHash: realTree,
    }, ctx)) as { exitCode: number };
    expect(ok.exitCode).toBe(0);

    const submitted = (await provider.invoke("submit", {
      statement: "host-bound claim",
      commit: realCommit,
    }, ctx)) as { claimId: string };
    const queried = (await provider.invoke("query", { claimId: submitted.claimId }, ctx)) as {
      claim: { binding?: { commit?: string; treeHash?: string; sessionId?: string } };
    };
    expect(queried.claim.binding).toEqual({
      commit: realCommit,
      treeHash: realTree,
      sessionId: "test",
    });
    await expect(provider.invoke("evaluate", {
      binding: { commit: realCommit, treeHash: "fabricated" },
    }, ctx)).rejects.toThrow(/binding.treeHash .* does not match the host workspace/);
    const hostBoundGate = (await provider.invoke("evaluate", {}, ctx)) as {
      capsule: { binding?: { commit: string; treeHash: string; sessionId?: string } };
    };
    expect(hostBoundGate.capsule.binding).toEqual({
      commit: realCommit,
      treeHash: realTree,
      sessionId: "test",
    });
    // A command not in the allowlist is rejected without executing.
    await expect(
      provider.invoke("run", {
        command: "which",
        args: ["node"],
        cwd: process.cwd(),
        commit: "abc",
        treeHash: realTree,
      }, ctx),
    ).rejects.toThrow(/not an exact configured trusted command/);
    // A configured command with different args is rejected.
    await expect(
      provider.invoke("run", {
        name: "node",
        command: "node",
        args: ["-e", "console.log('other')"],
        cwd: process.cwd(),
        commit: "abc",
        treeHash: realTree,
      }, ctx),
    ).rejects.toThrow(/does not accept the requested args/);
    // A cwd outside the host workspace is rejected.
    await expect(
      provider.invoke("run", {
        command: "node",
        args: ["-e", "console.log('ok')"],
        cwd: os.tmpdir(),
        commit: "abc",
        treeHash: realTree,
      }, ctx),
    ).rejects.toThrow(/outside the host-owned workspace/);
    // A caller-fabricated tree hash is rejected even for an allowed command.
    await expect(
      provider.invoke("run", {
        name: "node",
        command: "node",
        args: ["-e", "console.log('ok')"],
        cwd: process.cwd(),
        commit: realCommit,
        treeHash: "fabricated",
      }, ctx),
    ).rejects.toThrow(/supplied treeHash .* does not match the workspace/);
  });

  it("rejects invalid submit args", async () => {
    const provider = open();
    await expect(
      provider.invoke("submit", { statement: "", commit: "abc" }, ctx),
    ).rejects.toThrow();
  });

  it("rejects conflicting and malformed claim bindings", async () => {
    const provider = open();
    await expect(provider.invoke("submit", {
      statement: "bound",
      commit: "abc",
      binding: { commit: "def", treeHash: "t" },
    }, ctx)).rejects.toThrow("binding.commit must match commit");
    await expect(provider.invoke("submit", {
      statement: "bound",
      commit: "abc",
      binding: { commit: 1 },
    }, ctx)).rejects.toThrow("binding.commit must be a non-empty string");
    await expect(provider.invoke("submit", {
      statement: "partially bound",
      commit: "abc",
      binding: { commit: "abc" },
    }, ctx)).rejects.toThrow("binding.treeHash must be a non-empty string");
  });

  it.skipIf(process.platform === "win32")("rejects a cwd symlink that escapes the host workspace", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ev-workspace-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ev-outside-"));
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "fabric@example.invalid"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", "Fabric Test"], { cwd: workspace });
    fs.writeFileSync(path.join(workspace, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: workspace });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
      cwd: workspace,
      stdio: "ignore",
    });
    const escape = path.join(workspace, "escape");
    fs.symlinkSync(outside, escape, "dir");
    const provider = new EvidenceProvider({
      evidenceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ev-prov-")),
      sessionId: "test",
      workspaceRoot: workspace,
      trustedCommands: {
        node: { command: "node", args: ["--version"], shell: false, timeoutMs: 10_000 },
      },
    });
    await expect(provider.invoke("run", {
      name: "node",
      command: "node",
      args: ["--version"],
      cwd: escape,
      commit: CommandBroker.commitHash(workspace),
      treeHash: CommandBroker.treeHash(workspace),
    }, ctx)).rejects.toThrow(/outside the host-owned workspace/);
  });

  it("treats a configured empty trusted-command map as deny-all", async () => {
    const provider = new EvidenceProvider({
      evidenceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ev-prov-")),
      sessionId: "test",
      workspaceRoot: process.cwd(),
      trustedCommands: {},
    });
    await expect(provider.invoke("run", {
      command: "node",
      args: ["-e", "console.log('must not run')"],
      cwd: process.cwd(),
      commit: CommandBroker.commitHash(process.cwd()),
      treeHash: CommandBroker.treeHash(process.cwd()),
    }, ctx)).rejects.toThrow(/not an exact configured trusted command/);
  });
});

  it("evaluate accepts criteria and a commit/tree binding", async () => {
    const provider = open();
    const c = (await provider.invoke("submit", {
      statement: "ev-install-no-write",
      commit: "abc",
      criterionId: "KIRO-1",
      evidenceSource: "oracle",
      binding: { commit: "abc", treeHash: "t" },
    }, ctx)) as { claimId: string };
    await provider.invoke("hypothesize", { claimId: c.claimId, by: "inv" }, ctx);
    await provider.invoke("support", { claimId: c.claimId, by: "ver", evidence: [{ ref: "f" }] }, ctx);
    await provider.invoke("confirm", { claimId: c.claimId, by: "ver", evidence: [{ ref: "f" }] }, ctx);
    const out = (await provider.invoke("evaluate", {
      criteria: [{ criterionId: "c1" }],
      binding: { commit: "abc", treeHash: "t" },
    }, ctx)) as { status: string; missingCriterionIds: string[]; capsule: { criterionIds: string[] } };
    expect(out.status).toBe("defer");
    expect(out.missingCriterionIds).toEqual(["c1"]);
  });
