import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentArchive } from "../scripts/create-agent-archive.mjs";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";

const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

interface TarEntry {
  name: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  modifiedAt: number;
  type: string;
}

const octalField = (header: Buffer, offset: number, length: number): number => {
  const text = header.toString("ascii", offset, offset + length).replace(/\0.*$/u, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
};

const parseTar = (bytes: Buffer): TarEntry[] => {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = octalField(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    expect(checksumHeader.reduce((sum, byte) => sum + byte, 0)).toBe(expectedChecksum);
    expect(header.toString("ascii", 257, 263)).toBe("ustar\0");
    expect(header.toString("ascii", 263, 265)).toBe("00");
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/u, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/u, "");
    const size = octalField(header, 124, 12);
    entries.push({
      name: prefix ? `${prefix}/${name}` : name,
      mode: octalField(header, 100, 8),
      uid: octalField(header, 108, 8),
      gid: octalField(header, 116, 8),
      size,
      modifiedAt: octalField(header, 136, 12),
      type: String.fromCharCode(header[156]!),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  expect(bytes.subarray(offset, offset + 1_024).every((byte) => byte === 0)).toBe(true);
  return entries;
};

const bytewise = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

describe("deterministic Agent archive", () => {
  it("writes normalized USTAR bytes that extract to the exact staged package", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-archive-test-"));
    roots.push(root);
    const first = path.join(root, "first.tar.gz");
    const second = path.join(root, "second.tar.gz");
    const sourceDateEpoch = 1_700_000_000;
    const firstResult = createAgentArchive(".tmp/kiro-fabric-agent", first, { sourceDateEpoch });
    const secondResult = createAgentArchive(".tmp/kiro-fabric-agent", second, { sourceDateEpoch: String(sourceDateEpoch) });
    const firstBytes = fs.readFileSync(first);
    expect(fs.readFileSync(second)).toEqual(firstBytes);
    expect(secondResult.digest).toBe(firstResult.digest);
    expect([...firstBytes.subarray(4, 8)]).toEqual([0, 0, 0, 0]);

    const stageEvidence = validateAgentPackage(".tmp/kiro-fabric-agent");
    const entries = parseTar(gunzipSync(firstBytes));
    expect(entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name).sort(bytewise));
    expect(entries.filter((entry) => entry.type === "0")).toHaveLength(stageEvidence.files);
    for (const entry of entries) {
      expect(["0", "5"]).toContain(entry.type);
      expect(entry.mode).toBe(entry.type === "5" ? 0o700 : 0o600);
      expect(entry.uid).toBe(0);
      expect(entry.gid).toBe(0);
      expect(entry.modifiedAt).toBe(sourceDateEpoch);
      expect(entry.name.startsWith("/") || entry.name.split("/").includes("..")).toBe(false);
    }

    const extracted = path.join(root, "extracted");
    fs.mkdirSync(extracted, { mode: 0o700 });
    const unpack = spawnSync("tar", ["-xzf", first, "-C", extracted], { encoding: "utf8" });
    expect(unpack.status, unpack.stderr).toBe(0);
    expect(validateAgentPackage(extracted).digest).toBe(firstResult.packageDigest);
    const nestedOutput = path.join(extracted, "forbidden.tar.gz");
    expect(() => createAgentArchive(extracted, nestedOutput)).toThrow("outside the staged package");
    expect(fs.existsSync(nestedOutput)).toBe(false);
  });

  it("rejects invalid reproducible-build epochs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-archive-epoch-"));
    roots.push(root);
    for (const sourceDateEpoch of ["-1", "1.5", "not-a-date", Number.MAX_SAFE_INTEGER]) {
      expect(() => createAgentArchive(".tmp/kiro-fabric-agent", path.join(root, `${String(sourceDateEpoch)}.tar.gz`), { sourceDateEpoch })).toThrow(/SOURCE_DATE_EPOCH|USTAR numeric field/u);
    }
  });
});
