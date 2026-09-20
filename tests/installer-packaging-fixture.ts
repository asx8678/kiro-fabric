import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import { captureBuildInputs } from "../scripts/build-inputs.mjs";
import { acquirePrivateToolsForTest } from "../scripts/build-private-tools.mjs";
import { fixtureTools } from "./bundle-fixture.js";

export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function put(root: string, name: string, bytes: string | Buffer, mode = 0o600) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode }); fs.chmodSync(file, mode);
}
export function packagingFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-packaging-")));
  for (const directory of ["scripts", "src", "skills"]) fs.cpSync(path.resolve(directory), path.join(root, directory), { recursive: true });
  fs.copyFileSync(path.resolve("agent-product.json"), path.join(root, "agent-product.json"));
  put(root, "package.json", JSON.stringify({ name: "kiro-fabric", version: "1.0.0", type: "module" }));
  for (const name of ["pnpm-lock.yaml", "tsconfig.json", "tsconfig.build.json"]) put(root, name, "{}");
  put(root, "scripts/install-manager.mjs", "export const fixtureManager = true;\n");
  put(root, "src/fixture-entry.ts", "export const fixture = 'A';\n");
  put(root, "resources/steering/fabric.md", "fixture steering\n");
  put(root, "build-toolchain.json", JSON.stringify({ targets: { "linux-x64": fixtureTools() } }));
  fs.mkdirSync(path.join(root, ".tmp"), { mode: 0o700 });
  refreshFixtureClosure(root);
  return root;
}
export function refreshFixtureClosure(root: string) {
  const content = buildSync({ entryPoints: [path.join(root, "src/fixture-entry.ts")], bundle: true, format: "esm", target: "node24", write: false, logLevel: "silent" }).outputFiles[0]!.text;
  const buildInputs = captureBuildInputs(root), digest = createHash("sha256");
  const members: Record<string, string> = { "kiro/mcp-entry.js": content, "package.json": '{"name":"kiro-fabric-agent-runtime","type":"module","private":true}', "runtime/compiler-worker-entry.js": content, "runtime/sandbox-worker-entry.js": content };
  // Inert entrypoints keep the fixture hermetic; attribution bytes are real inputs.
  members["fovea/engine-entry.js"] = content;
  members["kiro/fovea-hook.js"] = content;
  for (const name of ["component.json", "upstream.json", "ast-grep-LICENSE.txt"]) {
    members[`fovea/${name}`] = fs.readFileSync(path.join(root, "src/fovea", name), "utf8");
  }
  members["fovea/UPSTREAM-LICENSE.txt"] = fs.readFileSync(path.join(root, "src/fovea/core/UPSTREAM-LICENSE.txt"), "utf8");
  const files = Object.keys(members).sort().map(name => {
    const bytes = members[name]!; put(root, `dist/kiro-agent-closure/${name}`, bytes);
    digest.update(name).update("\0").update(bytes);
    return { path: name, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  });
  put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify({ schemaVersion: 1, product: "kiro-fabric-agent", entrypoint: "kiro/mcp-entry.js", compilerWorker: "runtime/compiler-worker-entry.js", sandboxWorker: "runtime/sandbox-worker-entry.js", executor: "quickjs", foveaEngine: "fovea/engine-entry.js", foveaHook: "kiro/fovea-hook.js", vendoredComponents: [JSON.parse(members["fovea/component.json"]!)], buildInputs, files, contentDigest: digest.digest("hex") }));
}
export function fixtureDependencies() {
  return {
    provenance: (root: string) => ({ kind: "local-source", sourceDigest: captureBuildInputs(root).digest, gitHead: "a".repeat(40), dirty: true }),
    compileManager: async (root: string, outfile: string) => {
      buildSync({ entryPoints: [path.join(root, "scripts/install-manager.mjs")], outfile, bundle: true, format: "esm", platform: "node", target: "node24", logLevel: "silent" }); fs.chmodSync(outfile, 0o600);
    },
    acquireTools: async (target: string, destination: string, root: string) => {
      const pins = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8")).targets[target];
      return acquirePrivateToolsForTest(target, destination, { pins, qualification: { fixture: true }, download: async () => Buffer.from("archive"), extract: (_archive: string, member: string) => {
        const pin = (Object.values(pins) as { members: { member: string; path: string; sha256: string }[] }[]).flatMap(tool => tool.members).find(pin => pin.member === member)!;
        for (const prefix of ["fixture ", "updated "]) { const bytes = Buffer.from(prefix + pin.path); if (hash(bytes) === pin.sha256) return bytes; }
        throw new Error("Unrecognized fixture pin");
      } });
    },
  };
}
