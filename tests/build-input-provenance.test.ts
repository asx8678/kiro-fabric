import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import { captureBuildInputs, verifyBuildClosure, verifyClosureIntegrity, validateBuildInputProvenance } from "../scripts/build-inputs.mjs";

const roots: string[] = [];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function put(root: string, name: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-input-provenance-"));
  roots.push(root);
  for (const directory of ["scripts", "src"]) fs.cpSync(path.resolve(directory), path.join(root, directory), { recursive: true });
  for (const name of ["package.json", "pnpm-lock.yaml", "agent-product.json", "tsconfig.json", "tsconfig.build.json"]) put(root, name, "{}");
  put(root, "src/kiro/first-prompt-hook.ts", "export const hook = 'A';");
  put(root, "skills/fabric-exec/SKILL.md", "guidance A");
  put(root, "resources/steering/fabric.md", "steering A");
  return root;
}
function build(root: string, content?: string) {
  const buildInputs = captureBuildInputs(root);
  content ??= buildSync({ entryPoints: [path.join(root, "src/kiro/first-prompt-hook.ts")], bundle: true, format: "esm", write: false, logLevel: "silent" }).outputFiles[0]!.text;
  const manifest = {
    schemaVersion: 1,
    buildInputs,
    files: [{ path: "entry.js", bytes: Buffer.byteLength(content), sha256: sha(content) }],
    contentDigest: createHash("sha256").update("entry.js\0").update(content).digest("hex"),
  };
  put(root, "dist/kiro-agent-closure/entry.js", content);
  put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify(manifest));
  return manifest;
}
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("build input provenance", () => {
  it.each(["src/kiro/first-prompt-hook.ts", "skills/fabric-exec/SKILL.md", "resources/steering/fabric.md", "scripts/agent-profile.mjs", "scripts/install.mjs", "scripts/esbuild-common.mjs", "scripts/normalize-artifact-modes.mjs", "pnpm-lock.yaml"])("rejects build A after %s changes to B, accepts rebuild", name => {
    const root = fixture();
    const initial = build(root);
    expect(verifyBuildClosure(root).buildInputs.digest).toBe(initial.buildInputs.digest);
    fs.appendFileSync(path.join(root, name), "\n// B");
    expect(() => verifyBuildClosure(root)).toThrow(/Build inputs changed/);
    build(root);
    expect(() => verifyBuildClosure(root)).not.toThrow();
  });
  it("ignores tests, reports, runtime data and unrelated scripts; sorts deterministically", () => {
    const root = fixture(); const initial = build(root);
    for (const name of ["tests/new.test.ts", "audits/report.json", ".tmp/runtime.json", "scripts/efficiency-baseline.mjs"]) put(root, name, "changed");
    expect(captureBuildInputs(root)).toEqual(initial.buildInputs);
    expect(initial.buildInputs.files.map((entry: { path: string }) => entry.path)).toEqual(initial.buildInputs.files.map((entry: { path: string }) => entry.path).sort());
    expect(() => verifyBuildClosure(root)).not.toThrow();
  });
  it("rejects additions, deletions and closure tampering independently", () => {
    const root = fixture(); build(root);
    put(root, "src/new.ts", "B"); expect(() => verifyBuildClosure(root)).toThrow(/Build inputs changed/);
    fs.unlinkSync(path.join(root, "src/new.ts"));
    put(root, "dist/kiro-agent-closure/entry.js", "tampered"); expect(() => verifyBuildClosure(root)).toThrow(/checksum/);
    build(root); fs.unlinkSync(path.join(root, "resources/steering/fabric.md"));
    expect(() => verifyBuildClosure(root)).toThrow(/Build inputs changed/);
  });
  it.each([null, {}, { schemaVersion: 1, files: null }, { schemaVersion: 1, files: [{ path: "../escape" }], contentDigest: "0".repeat(64) }])("fails closed on malformed closure manifests: %j", invalid => {
    const root = fixture(); build(root);
    put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify(invalid));
    expect(() => verifyBuildClosure(root)).toThrow(/manifest/i);
  });
  it("rejects missing, malformed and forged provenance", () => {
    const root = fixture(); const initial = build(root);
    for (const buildInputs of [undefined, {}, { ...initial.buildInputs, digest: "0".repeat(64) }, { ...initial.buildInputs, files: [null] }]) {
      put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify({ ...initial, buildInputs }));
      expect(() => verifyBuildClosure(root)).toThrow(/Invalid build input provenance/);
    }
    put(root, "dist/kiro-agent-closure/closure-manifest.json", "{");
    expect(() => verifyBuildClosure(root)).toThrow(/Invalid or missing closure manifest/);
  });
  it("separates intact stale closure bytes from invalid provenance without weakening either", () => {
    const root = fixture(), initial = build(root), closure = path.join(root, "dist/kiro-agent-closure");
    fs.appendFileSync(path.join(root, "src/kiro/first-prompt-hook.ts"), "// changed");
    expect(verifyClosureIntegrity(closure).contentDigest).toBe(initial.contentDigest);
    expect(validateBuildInputProvenance(initial.buildInputs)).toEqual(initial.buildInputs);
    expect(() => verifyBuildClosure(root)).toThrow(/Build inputs changed/);
    expect(() => validateBuildInputProvenance({ ...initial.buildInputs, digest: "0".repeat(64) })).toThrow(/Invalid build input provenance/);
    put(root, "dist/kiro-agent-closure/entry.js", "tampered");
    expect(() => verifyClosureIntegrity(closure)).toThrow(/checksum/);
  });
});
