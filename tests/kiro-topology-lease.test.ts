import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  KiroTopologyLeaseLostError,
  createKiroTopologyLease,
} from "../src/kiro/topology.js";
import { MeshStore } from "../src/mesh/store.js";

const roots: string[] = [];

const scratch = (): { projectRoot: string; meshRoot: string } => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "kiro-topology-lease-"));
  roots.push(projectRoot);
  const meshRoot = path.join(projectRoot, "mesh");
  process.env.KIRO_FABRIC_PROJECT_ROOT = projectRoot;
  process.env.KIRO_FABRIC_MESH_ROOT = meshRoot;
  return { projectRoot, meshRoot };
};

afterEach(() => {
  delete process.env.KIRO_FABRIC_PROJECT_ROOT;
  delete process.env.KIRO_FABRIC_MESH_ROOT;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Kiro topology lifecycle leases", () => {
  it("renews both records and removes only its owned versions on close", async () => {
    const { meshRoot } = scratch();
    const lease = await createKiroTopologyLease(
      { rootId: "root-renew", sessionId: "session-renew", roles: ["main"] },
      { leaseMs: 30_000 },
    );
    const mesh = new MeshStore(meshRoot, 256 * 1024, 500);
    const initialHost = mesh.get(lease.hostKey)!;
    const initialParticipant = mesh.get(lease.participantKey)!;
    const initialExpiry = lease.host.expiresAt;

    const renewed = await lease.heartbeat();

    expect(renewed.host.expiresAt).toBeGreaterThan(initialExpiry);
    expect(mesh.get(lease.hostKey)!.version).toBeGreaterThan(initialHost.version);
    expect(mesh.get(lease.participantKey)!.version).toBeGreaterThan(initialParticipant.version);
    expect(renewed.host.kiro.lease?.ownerToken).toBe(lease.ownerToken);
    expect(renewed.participant.kiro.lease?.ownerToken).toBe(lease.ownerToken);

    await expect(lease.close()).resolves.toEqual({
      participantDeleted: true,
      hostDeleted: true,
      ownershipLost: false,
    });
    expect(mesh.get(lease.hostKey)).toBeUndefined();
    expect(mesh.get(lease.participantKey)).toBeUndefined();
  });

  it("fences a superseded lease from renewing or deleting the newer owner's records", async () => {
    const { meshRoot } = scratch();
    const input = { rootId: "root-fenced", sessionId: "session-fenced", roles: ["main"] };
    const oldLease = await createKiroTopologyLease(input);
    const newLease = await createKiroTopologyLease(input);
    const mesh = new MeshStore(meshRoot, 256 * 1024, 500);

    expect(newLease.ownerToken).not.toBe(oldLease.ownerToken);
    await expect(oldLease.heartbeat()).rejects.toBeInstanceOf(KiroTopologyLeaseLostError);

    await expect(oldLease.close()).resolves.toEqual({
      participantDeleted: false,
      hostDeleted: false,
      ownershipLost: true,
    });
    expect((mesh.get(newLease.hostKey)!.value as typeof newLease.host).kiro.lease?.ownerToken)
      .toBe(newLease.ownerToken);
    expect(
      (mesh.get(newLease.participantKey)!.value as typeof newLease.participant).kiro.lease
        ?.ownerToken,
    ).toBe(newLease.ownerToken);

    await newLease.close();
    expect(mesh.get(newLease.hostKey)).toBeUndefined();
    expect(mesh.get(newLease.participantKey)).toBeUndefined();
  });

  it("serializes a racing heartbeat and close without leaving owned records", async () => {
    const { meshRoot } = scratch();
    const lease = await createKiroTopologyLease({
      rootId: "root-race",
      sessionId: "session-race",
      roles: ["main"],
    });
    const mesh = new MeshStore(meshRoot, 256 * 1024, 500);
    const [renewed, closed] = await Promise.all([lease.heartbeat(), lease.close()]);
    expect(renewed.host.kiro.lease?.ownerToken).toBe(lease.ownerToken);
    expect(closed).toMatchObject({
      participantDeleted: true,
      hostDeleted: true,
      ownershipLost: false,
    });
    expect(mesh.get(lease.hostKey)).toBeUndefined();
    expect(mesh.get(lease.participantKey)).toBeUndefined();
    await expect(lease.heartbeat()).rejects.toThrow(/closed/);
  });
});
