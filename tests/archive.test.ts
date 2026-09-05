import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { assertCapturedArchiveInventory, createAgentArchive } from "../scripts/create-agent-archive.mjs";
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
  it("binds the package digest to the exact captured bytes and normalized modes", () => {
    const evidence = validateAgentPackage(".tmp/kiro-fabric-agent");
    const captured = [
      ...evidence.inventory.directories
        .filter((entry) => entry.path !== ".")
        .map((entry) => ({ relative: entry.path, directory: true, size: 0, content: undefined })),
      ...evidence.inventory.files.map((entry) => {
        const content = fs.readFileSync(path.join(evidence.root, ...entry.path.split("/")));
        return { relative: entry.path, directory: false, size: content.length, content };
      }),
    ];
    expect(() => assertCapturedArchiveInventory(evidence, captured)).not.toThrow();
    const changed = captured.map((entry) => ({ ...entry }));
    const file = changed.find((entry) => !entry.directory)!;
    file.content = Buffer.from(file.content!);
    file.content[0] = file.content[0]! ^ 0xff;
    expect(() => assertCapturedArchiveInventory(evidence, changed)).toThrow("bytes or modes changed");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-archive-mode-test-"));
    roots.push(root);
    const packageRoot = path.join(root, "package");
    fs.mkdirSync(packageRoot, { mode: 0o700 });
    fs.cpSync(evidence.root, packageRoot, { recursive: true, preserveTimestamps: true });
    // fs.cpSync preserves file modes but creates directories with the umask
    // default (group-writable under umask 002), which the package validator
    // correctly rejects. Normalize directory modes explicitly.
    const normalizeDirectoryModes = (directory: string): void => {
      fs.chmodSync(directory, 0o700);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) normalizeDirectoryModes(path.join(directory, entry.name));
      }
    };
    normalizeDirectoryModes(packageRoot);
    const fileWithSafeButNonCanonicalMode = path.join(packageRoot, "skills", "fabric-exec", "SKILL.md");
    fs.chmodSync(fileWithSafeButNonCanonicalMode, 0o640);
    expect(validateAgentPackage(packageRoot).ok).toBe(true);
    expect(() => createAgentArchive(packageRoot, path.join(root, "mode.tar.gz"))).toThrow("bytes or modes changed");
  });

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
    const extractedEvidence = validateAgentPackage(extracted);
    expect(extractedEvidence.digest).toBe(firstResult.packageDigest);
    expect(fs.existsSync(path.join(extracted, "agent.json"))).toBe(false);
    expect(fs.existsSync(path.join(extracted, ".kiro"))).toBe(false);
    for (const installer of ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"]) {
      expect(fs.existsSync(path.join(extracted, "scripts", installer)), installer).toBe(true);
    }
    for (const entry of extractedEvidence.inventory.files) {
      const bytes = fs.readFileSync(path.join(extracted, ...entry.path.split("/")));
      expect(bytes.includes(Buffer.from(path.resolve("."))), entry.path).toBe(false);
      expect(bytes.includes(Buffer.from(process.execPath)), entry.path).toBe(false);
    }

    const home = path.join(root, "unrelated-home");
    const workspace = path.join(root, "unrelated-workspace");
    const kiroHome = path.join(home, ".kiro");
    fs.mkdirSync(home, { mode: 0o700 });
    fs.mkdirSync(workspace, { mode: 0o700 });
    const canonicalKiroHome = path.join(fs.realpathSync(home), ".kiro");
    const workspaceBefore = fs.readdirSync(workspace);
    const install = spawnSync(process.execPath, [path.join(extracted, "scripts", "install-agent-user.mjs")], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, HOME: home, KIRO_HOME: kiroHome },
      timeout: 60_000,
    });
    expect(install.status, install.stderr).toBe(0);
    const installed = JSON.parse(install.stdout.split("\n")[0]!);
    expect(installed.profile).toBe(path.join(canonicalKiroHome, "agents", "kiro-fabric.json"));
    expect(installed.runtime.startsWith(path.join(canonicalKiroHome, "kiro-fabric", "runtime"))).toBe(true);
    expect(installed.runtime.includes(fs.realpathSync(extracted))).toBe(false);
    expect(installed.runtime.includes(path.resolve("."))).toBe(false);
    expect(fs.existsSync(installed.profile)).toBe(true);
    expect(fs.existsSync(path.join(installed.runtime, "kiro", "mcp-entry.js"))).toBe(true);
    expect(fs.readdirSync(workspace)).toEqual(workspaceBefore);
    expect(install.stdout).toContain("kiro-cli --v3 --agent kiro-fabric");
    expect(install.stdout).toContain("kiro-cli agent validate --path");
    expect(install.stdout).not.toContain("kiro-cli chat --agent");

    const uninstall = spawnSync(process.execPath, [path.join(extracted, "scripts", "install-agent-user.mjs"), "--uninstall"], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, HOME: home, KIRO_HOME: kiroHome },
      timeout: 60_000,
    });
    expect(uninstall.status, uninstall.stderr).toBe(0);
    expect(fs.existsSync(installed.profile)).toBe(false);
    expect(fs.existsSync(installed.data)).toBe(true);
    expect(fs.readdirSync(workspace)).toEqual(workspaceBefore);
    const nestedOutput = path.join(extracted, "forbidden.tar.gz");
    expect(() => createAgentArchive(extracted, nestedOutput)).toThrow("outside the staged package");
    expect(fs.existsSync(nestedOutput)).toBe(false);

    const productPath = path.join(extracted, "agent-product.json");
    const productBytes = fs.readFileSync(productPath);
    const product = JSON.parse(productBytes.toString("utf8"));
    product.mountedProviders = [...product.mountedProviders].reverse();
    fs.writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`, { mode: 0o600 });
    expect(() => validateAgentPackage(extracted)).toThrow("agent product authority digest drifted");
    fs.writeFileSync(productPath, productBytes, { mode: 0o600 });
    expect(validateAgentPackage(extracted).digest).toBe(firstResult.packageDigest);
    const emptySkill = path.join(extracted, "skills", "unexpected-empty-skill");
    fs.mkdirSync(emptySkill, { mode: 0o700 });
    expect(() => validateAgentPackage(extracted)).toThrow("skills root inventory drifted");
    fs.rmdirSync(emptySkill);
    const emptyRuntime = path.join(extracted, "runtime", "unexpected-empty-directory");
    fs.mkdirSync(emptyRuntime, { mode: 0o700 });
    expect(() => validateAgentPackage(extracted)).toThrow("closure directory inventory drifted");
    fs.rmdirSync(emptyRuntime);
    expect(validateAgentPackage(extracted).digest).toBe(firstResult.packageDigest);
  });

  it("rejects invalid reproducible-build epochs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-archive-epoch-"));
    roots.push(root);
    for (const sourceDateEpoch of ["-1", "1.5", "not-a-date", Number.MAX_SAFE_INTEGER]) {
      expect(() => createAgentArchive(".tmp/kiro-fabric-agent", path.join(root, `${String(sourceDateEpoch)}.tar.gz`), { sourceDateEpoch })).toThrow(/SOURCE_DATE_EPOCH|USTAR numeric field/u);
    }
  });
});
