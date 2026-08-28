import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeshStore, type MeshIdentity } from "../src/mesh/store.js";
import {
  RESIDENT_HOST_FORMAT,
  RESIDENT_STATE_VERSION,
  isCurrentResidentEpoch,
  isStaleEpoch,
  isValidResidentEpoch,
  migrateResidentStateVersion1to2,
  residentDeliveryPayloadDigest,
  residentDeliveryPrefix,
  residentHostId,
  type ResidentDeliveryRecord,
} from "../src/residency/protocol.js";

const roots: string[] = [];

const identity = (id: string): MeshIdentity => ({ id, name: id, kind: "agent" });

const tempMesh = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "residency-durability-"));
  roots.push(root);
  return new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
};

const putJson = async (mesh: MeshStore, key: string, value: unknown, by: MeshIdentity) => {
  const existing = mesh.get(key);
  return mesh.put({
    key,
    value,
    identity: by,
    ...(existing ? { ifVersion: existing.version } : { ifVersion: 0 }),
  });
};

interface DurableDelivery extends ResidentDeliveryRecord {
  epoch: number;
}

class DurableResidencyHarness {
  readonly hostId: string;
  readonly deliveryPrefix: string;
  readonly ownerKey: string;
  readonly claimPrefix: string;
  readonly effectPrefix: string;
  readonly completePrefix: string;

  constructor(
    readonly mesh: MeshStore,
    readonly rootId: string,
    readonly currentEpoch: number,
    readonly deliveredQueue: string[],
  ) {
    this.hostId = residentHostId(rootId);
    this.deliveryPrefix = residentDeliveryPrefix(rootId);
    this.ownerKey = `residency/test-owner/${rootId}`;
    this.claimPrefix = `residency/test-claims/${rootId}/`;
    this.effectPrefix = `residency/test-effects/${rootId}/`;
    this.completePrefix = `residency/test-complete/${rootId}/`;
  }

  async enqueue(id: string, epoch: number, message = id): Promise<void> {
    const record: DurableDelivery = {
      format: RESIDENT_HOST_FORMAT,
      id,
      rootId: this.rootId,
      from: { id: "actor:test", name: "actor:test", kind: "actor" },
      delivery: "followUp",
      triggerTurn: false,
      message,
      createdAt: Date.now(),
      epoch,
    };
    await this.mesh.put({
      key: `${this.deliveryPrefix}${id}`,
      value: record,
      identity: identity(this.hostId),
      ifVersion: 0,
    });
  }

  async claimSingleOwner(ownerId: string, epoch: number): Promise<boolean> {
    if (epoch !== this.currentEpoch) return false;
    const current = this.mesh.get(this.ownerKey);
    const currentValue = current?.value as { ownerId?: string; epoch?: number } | undefined;
    if (typeof currentValue?.epoch === "number" && currentValue.epoch > epoch) return false;
    await putJson(this.mesh, this.ownerKey, { ownerId, epoch }, identity(ownerId));
    return true;
  }

  async drainOnce(options: { crashAfterEffect?: boolean } = {}): Promise<void> {
    for (const entry of this.mesh.listAll(this.deliveryPrefix)) {
      const value = entry.value as Partial<DurableDelivery>;
      if (
        value.format !== RESIDENT_HOST_FORMAT ||
        value.rootId !== this.rootId ||
        typeof value.id !== "string" ||
        typeof value.epoch !== "number"
      ) {
        continue;
      }
      if (value.epoch !== this.currentEpoch) continue;
      const claimKey = `${this.claimPrefix}${value.id}`;
      const claim = this.mesh.get(claimKey);
      const claimValue = claim?.value as { epoch?: number } | undefined;
      if (typeof claimValue?.epoch === "number" && claimValue.epoch < this.currentEpoch) continue;
      if (!claim) {
        await this.mesh.put({
          key: claimKey,
          value: { deliveryId: value.id, epoch: this.currentEpoch, ownerHostId: this.hostId },
          identity: identity(this.hostId),
          ifVersion: 0,
        });
      }
      const effectKey = `${this.effectPrefix}${value.id}`;
      if (!this.mesh.get(effectKey)) {
        await this.mesh.put({
          key: effectKey,
          value: { delivered: true, deliveryId: value.id },
          identity: identity(this.hostId),
          ifVersion: 0,
        });
        this.deliveredQueue.push(value.id);
        if (options.crashAfterEffect) return;
      }
      const completeKey = `${this.completePrefix}${value.id}`;
      if (!this.mesh.get(completeKey)) {
        await this.mesh.put({
          key: completeKey,
          value: { complete: true, deliveryId: value.id },
          identity: identity(this.hostId),
          ifVersion: 0,
        });
      }
      await this.mesh.delete({ key: entry.key, ifVersion: entry.version });
    }
  }

  isClaimed(id: string): boolean {
    return this.mesh.get(`${this.claimPrefix}${id}`) !== undefined;
  }

  isCompleted(id: string): boolean {
    return this.mesh.get(`${this.completePrefix}${id}`) !== undefined;
  }
}

const reconcileTrust = (
  serverTrustedIds: ReadonlySet<string>,
  clientClaim: { id: string; trusted?: boolean },
) => ({
  id: clientClaim.id,
  trusted: serverTrustedIds.has(clientClaim.id),
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("residency durability", () => {
  it("migrates v1 state to v2 and rejects unknown future state", () => {
    const v1 = {
      format: RESIDENT_HOST_FORMAT,
      hostId: "resident:test",
      pid: 123,
      token: "token",
      startedAt: 1,
      readyAt: 2,
    };
    expect(migrateResidentStateVersion1to2(v1)).toEqual({
      ...v1,
      stateVersion: RESIDENT_STATE_VERSION,
      epoch: 0,
    });
    expect(v1).not.toHaveProperty("stateVersion");
    expect(() => migrateResidentStateVersion1to2({ stateVersion: 3 })).toThrow(
      /Unsupported resident state version: 3/,
    );
    expect(isStaleEpoch(2, 3)).toBe(true);
    expect(isStaleEpoch(3, 3)).toBe(false);
    expect(isCurrentResidentEpoch(3, 3)).toBe(true);
    expect(isCurrentResidentEpoch(4, 3)).toBe(false);
    expect(isValidResidentEpoch(0)).toBe(true);
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isValidResidentEpoch(invalid)).toBe(false);
      expect(() => migrateResidentStateVersion1to2({
        stateVersion: RESIDENT_STATE_VERSION,
        epoch: invalid,
      })).toThrow(/Invalid resident state epoch/);
    }
    expect(residentDeliveryPayloadDigest("steer", "hello")).not.toBe(
      residentDeliveryPayloadDigest("followUp", "hello"),
    );
  });

  it("rejects stale-worker deliveries and stale owner claims", async () => {
    const mesh = tempMesh();
    const rootId = "root:stale";
    const delivered: string[] = [];
    const harness = new DurableResidencyHarness(mesh, rootId, 3, delivered);

    await harness.enqueue("fresh", 3);
    await harness.enqueue("stale", 2);
    await harness.enqueue("future", 4);

    await expect(harness.claimSingleOwner("worker:new", 3)).resolves.toBe(true);
    await expect(harness.claimSingleOwner("worker:old", 2)).resolves.toBe(false);
    await expect(harness.claimSingleOwner("worker:future", 4)).resolves.toBe(false);

    const owner = mesh.get(harness.ownerKey);
    expect(owner?.value).toEqual({ ownerId: "worker:new", epoch: 3 });

    await harness.drainOnce();

    expect(delivered).toEqual(["fresh"]);
    expect(harness.isClaimed("fresh")).toBe(true);
    expect(harness.isClaimed("stale")).toBe(false);
    expect(harness.isClaimed("future")).toBe(false);
    expect(mesh.get(`${harness.deliveryPrefix}stale`)?.value).toMatchObject({ id: "stale", epoch: 2 });
    expect(mesh.get(`${harness.deliveryPrefix}future`)?.value).toMatchObject({ id: "future", epoch: 4 });
  });

  it("does not duplicate mailbox delivery across a crash and host restart", async () => {
    const initialMesh = tempMesh();
    const rootId = "root:idempotent";
    const delivered: string[] = [];
    const firstHost = new DurableResidencyHarness(initialMesh, rootId, 7, delivered);

    await firstHost.enqueue("delivery-1", 7);
    await firstHost.drainOnce({ crashAfterEffect: true });

    expect(delivered).toEqual(["delivery-1"]);
    expect(firstHost.isClaimed("delivery-1")).toBe(true);
    expect(firstHost.isCompleted("delivery-1")).toBe(false);

    const restartedMesh = new MeshStore(initialMesh.root, 64 * 1024, 100);
    const restartedHost = new DurableResidencyHarness(restartedMesh, rootId, 7, delivered);
    await restartedHost.drainOnce();

    expect(delivered).toEqual(["delivery-1"]);
    expect(delivered.filter((id) => id === "delivery-1")).toHaveLength(1);
    expect(restartedHost.isCompleted("delivery-1")).toBe(true);
    expect(restartedMesh.listAll(restartedHost.deliveryPrefix)).toEqual([]);
  });

  it("keeps trust server-derived when a client claims trusted true", () => {
    const trusted = reconcileTrust(new Set<string>(), { id: "client:alice", trusted: true });
    const untrusted = reconcileTrust(new Set(["server:bob"]), { id: "client:alice", trusted: true });
    const trustedByServer = reconcileTrust(new Set(["client:alice"]), { id: "client:alice", trusted: false });

    expect(trusted).toEqual({ id: "client:alice", trusted: false });
    expect(untrusted).toEqual({ id: "client:alice", trusted: false });
    expect(trustedByServer).toEqual({ id: "client:alice", trusted: true });
  });
});
