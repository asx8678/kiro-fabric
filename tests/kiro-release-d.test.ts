import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  composeKiroSemanticHandoff,
  handoffFidelityOf,
  isKiroSemanticHandoff,
} from "../src/kiro/handoff.js";
import { KiroMemoryScopeError, openKiroMemory } from "../src/kiro/memory.js";
import { kiroFeatureDiagnostics, kiroParsiveFidelity } from "../src/kiro/diagnostics.js";
import { isKiroNode, recordKiroTopology } from "../src/kiro/topology.js";
import { MeshStore } from "../src/mesh/store.js";

const roots: string[] = [];

const scratch = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "kiro-fabric-release-d-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.KIRO_FABRIC_PROJECT_ROOT;
  delete process.env.KIRO_FABRIC_MESH_ROOT;
});

describe("Kiro Release D parity guards", () => {
  it("keeps handoff fidelity semantic and never claims native transcript fidelity", () => {
    const handoff = composeKiroSemanticHandoff({
      runnerSessionId: "session-1",
      step: "resume",
      nested: { b: 2, a: 1 },
      objective: " Continue the security review ",
      facts: ["ACP updates are explicit deltas"],
      relevantFiles: ["src/kiro/acp-worker.ts"],
    });

    expect(handoff.fidelity).toBe("semantic");
    expect(handoff.context).toEqual({
      objective: "Continue the security review",
      facts: ["ACP updates are explicit deltas"],
      relevantFiles: ["src/kiro/acp-worker.ts"],
    });
    expect(handoffFidelityOf(handoff)).toBe("semantic");
    expect(isKiroSemanticHandoff(handoff)).toBe(true);
    expect(isKiroSemanticHandoff({ fidelity: "native", digest: "x" })).toBe(false);
    expect(composeKiroSemanticHandoff({
      runnerSessionId: "session-1",
      objective: "Continue the security review",
      facts: ["ACP updates are explicit deltas"],
      relevantFiles: ["src/kiro/acp-worker.ts"],
    }).digest).toBe(handoff.digest);
    expect(isKiroSemanticHandoff({
      ...handoff,
      context: { ...handoff.context, objective: "tampered" },
    })).toBe(false);
  });

  it("rejects a Kiro memory key outside its namespace", async () => {
    const root = scratch();
    const memory = openKiroMemory("release-d", root);
    await expect(memory.get("..")).rejects.toBeInstanceOf(KiroMemoryScopeError);
  });

  it("provides bounded, ranked memory retrieval and metadata-only listing", async () => {
    const root = scratch();
    const memory = openKiroMemory("release-d-search", root);
    for (let index = 0; index < 20; index++) {
      await memory.set(`note-${String(index).padStart(2, "0")}`, {
        topic: index % 2 === 0 ? "routing" : "caching",
        detail: `fact ${index}`,
      });
    }
    const routing = await memory.search("routing", 3);
    expect(routing.length).toBeLessThanOrEqual(3);
    expect(routing.every((entry) => JSON.stringify(entry.value).includes("routing"))).toBe(true);
    // Key matches rank before value-only matches.
    const byKey = await memory.search("note-03");
    expect(byKey[0]?.key).toBe("note-03");
    // Empty query returns nothing rather than the whole namespace.
    await expect(memory.search("   ")).resolves.toEqual([]);
    const index = await memory.index();
    expect(index).toHaveLength(20);
    expect(index[0]).toHaveProperty("key");
    expect(index[0]).toHaveProperty("bytes");
    expect(index[0]).not.toHaveProperty("value");
  });

  it("persists Kiro topology records without requiring private session reads", async () => {
    const projectRoot = scratch();
    const meshRoot = path.join(projectRoot, "mesh-state");
    process.env.KIRO_FABRIC_PROJECT_ROOT = projectRoot;
    process.env.KIRO_FABRIC_MESH_ROOT = meshRoot;

    const persisted = await recordKiroTopology({
      rootId: "root-release-d",
      sessionId: "session-1",
      roles: ["main"],
    });

    const mesh = new MeshStore(meshRoot, 256 * 1024, 500);
    const hostEntries = mesh.listAll("topology/hosts/");
    const participantEntries = mesh.listAll("topology/participants/");
    const participantEntry = participantEntries.find((entry) => entry.key === persisted.participantKey);
    const hostEntry = hostEntries.find((entry) => entry.key === persisted.hostKey);

    expect(participantEntry).toBeDefined();
    expect(hostEntry).toBeDefined();
    expect(isKiroNode(participantEntry!)).toBe(true);
    expect(isKiroNode(hostEntry!)).toBe(true);
    expect(persisted.participant.runner).toBe("kiro");
    expect(mesh.listAll("sessions/")).toHaveLength(0);
  });

  it("reports Release D diagnostics as qualified or unavailable only", () => {
    const rows = kiroFeatureDiagnostics();

    expect(rows.length).toBeGreaterThan(0);
    expect(kiroParsiveFidelity()).toBe("semantic");
    expect(rows.every((row) => row.supported === "qualified" || row.supported === "unavailable")).toBe(true);
    expect(rows.every((row) => row.diagnostic.trim().length > 0)).toBe(true);
    expect(rows.some((row) => row.feature === "semantic handoff" && row.supported === "qualified")).toBe(true);
    expect(rows.some((row) => row.feature === "memory" && row.supported === "qualified")).toBe(true);
    expect(rows.some((row) => row.feature === "mcp federation" && row.supported === "qualified"))
      .toBe(true);
    expect(rows.some((row) => row.feature === "topology" && row.supported === "qualified")).toBe(true);
    expect(rows.some((row) => row.feature === "agents" && row.supported === "qualified"))
      .toBe(true);
    expect(rows.some((row) => /native transcript fidelity/i.test(row.diagnostic) && !/never|stays Pi-owned/i.test(row.diagnostic))).toBe(false);
  });
});
