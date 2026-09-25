// Inert, task-owned `smokeCandidate` fixture bundle. Retained fixtures only.
//
// This builds a structurally valid schema-1 bundle whose manifest is produced
// and re-validated by the REAL shared bundle contract (`createBundleManifest` /
// `validateBundle`). Its `tools/node` and `tools/rg` are inert Node shims, not
// real tool binaries, and its app closure is placeholder text. The bundle is
// deliberately non-functional: it must never be installed, executed as native
// material, or treated as runnable/native/authenticated evidence.
//
// The shim exists only as a strictly task-owned backend seam so the REAL
// `smokeCandidate` lifecycle (scratch creation, retention notice, backend spawn,
// rejection on failure / resolution on success) can be exercised offline.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { canonical, sha256, createBundleManifest, compatibilityFor } from "../bundle-contract.mjs";

const NODE_VERSION = "24.20.0";
const RG_VERSION = "14.1.1";

/** Inert MCP backend/tool shim for `tools/node`.
 * @param {string} nodePath @param {"failure"|"success"} mode @param {string} token */
function nodeShimSource(nodePath, mode, token) {
  return `#!${nodePath}
import fs from "node:fs";
import path from "node:path";
const mode = ${JSON.stringify(mode)};
const token = ${JSON.stringify(token)};
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("v${NODE_VERSION}\\n");
} else if (args.some(argument => argument.endsWith("mcp-entry.js"))) {
  // Write repository metadata (worktree .git plus a bare repository) inside the
  // private scratch the real smokeCandidate owns, then fail or answer.
  const cwd = process.cwd();
  fs.mkdirSync(path.join(cwd, ".git", "refs", "heads"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(cwd, ".git", "objects"), { mode: 0o700 });
  fs.writeFileSync(path.join(cwd, ".git", "config"), "[core]\\n\\trepositoryformatversion = 0\\n", { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, ".git", "HEAD"), "ref: refs/heads/main\\n", { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, ".git", "fabric-retention-token"), token + "\\n", { mode: 0o600 });
  const bare = path.join(cwd, "bare.git");
  fs.mkdirSync(path.join(bare, "refs", "heads"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(bare, "objects"), { mode: 0o700 });
  fs.writeFileSync(path.join(bare, "HEAD"), "ref: refs/heads/main\\n", { mode: 0o600 });
  fs.writeFileSync(path.join(bare, "config"), "[core]\\n\\tbare = true\\n", { mode: 0o600 });
  fs.writeFileSync(path.join(bare, "fabric-retention-token"), token + "\\n", { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, "retention-sentinel.txt"), token + "\\n", { mode: 0o600 });
  // Fixture-owned identity witness: ownership/mode/inode plus exact file bytes,
  // captured immediately before this inert backend exits or handshakes. This is
  // not production output and grants no native or authenticated qualification.
  const snapshot = (base, names) => names.map(relative => {
    const file = path.resolve(base, relative);
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("unexpected identity witness type");
    const row = { relative, type: stat.isFile() ? "file" : "directory", dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), uid: String(stat.uid), gid: String(stat.gid), nlink: String(stat.nlink) };
    if (stat.isFile()) Object.assign(row, { size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), bytes: fs.readFileSync(file).toString("hex") });
    return row;
  });
  fs.writeFileSync(path.join(cwd, "inert-env.json"), JSON.stringify(process.env), { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, "inert-identity.json"), "", { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(cwd, "inert-identity.json"), JSON.stringify(snapshot(cwd, ${JSON.stringify([".", ".git", ".git/refs", ".git/refs/heads", ".git/objects", ".git/HEAD", ".git/config", ".git/fabric-retention-token", "bare.git", "bare.git/refs", "bare.git/refs/heads", "bare.git/objects", "bare.git/HEAD", "bare.git/config", "bare.git/fabric-retention-token", "retention-sentinel.txt"])})), { mode: 0o600 });
  if (mode === "failure") {
    process.stderr.write("inert backend shim failure\\n");
    process.exit(3);
  }
  let buffer = "";
  const send = frame => process.stdout.write(JSON.stringify(frame) + "\\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buffer += chunk;
    while (buffer.includes("\\n")) {
      const end = buffer.indexOf("\\n");
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { process.exit(4); }
      if (frame.method === "initialize") send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "inert-smoke-backend", version: "1" } } });
      else if (frame.method === "tools/list") send({ jsonrpc: "2.0", id: frame.id, result: { tools: ["fabric_exec", "fabric_info", "fabric_workspace"].map(name => ({ name })) } });
      else if (frame.method === "tools/call") {
        const sentinel = frame.params && frame.params.arguments && frame.params.arguments.payloads && frame.params.arguments.payloads.needle;
        const text = JSON.stringify({ read: { path: "probe.txt", text: sentinel + "\\n", truncated: false, totalLines: 1 }, search: { truncated: false, matches: [{ path: "probe.txt", line: 1, text: sentinel }] } });
        send({ jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text }] } });
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
} else {
  process.stderr.write("inert smoke shim unexpected invocation\\n");
  process.exit(2);
}
`;
}

/** Inert ripgrep-version shim for `tools/rg`. @param {string} nodePath */
function rgShimSource(nodePath) {
  return `#!${nodePath}
process.stdout.write("ripgrep ${RG_VERSION}\\n");
`;
}

/** @param {string} root @param {string} relative @returns {{size:number, sha256:string}} */
function member(root, relative) {
  return { size: fs.statSync(path.join(root, relative)).size, sha256: sha256(fs.readFileSync(path.join(root, relative))) };
}

/**
 * Build the inert bundle into an existing private root.
 * @param {string} root @param {"failure"|"success"} mode
 * @returns {Promise<{root:string, manifest:any, digest:string, token:string, mode:string}>}
 */
export async function buildInertSmokeBundle(root, mode) {
  if (mode !== "failure" && mode !== "success") throw new Error("invalid inert smoke mode: " + mode);
  const token = randomBytes(12).toString("hex");
  /** @type {Array<[string, 0o700|0o600, string]>} */
  const files = [
    ["app/kiro/mcp-entry.js", 0o600, "export const inertSmokeBackendEntry = 1;\n"],
    ["app/runtime/compiler-worker-entry.js", 0o600, "export const compilerWorkerEntry = 1;\n"],
    ["app/runtime/sandbox-worker-entry.js", 0o600, "export const sandboxWorkerEntry = 1;\n"],
    ["app/package.json", 0o600, "{ \"name\": \"inert-smoke-fixture\" }\n"],
    ["app/closure-manifest.json", 0o600, "{ \"inert\": true }\n"],
    ["manager/install-manager.mjs", 0o600, "export const installManager = 1;\n"],
    ["resources/steering/fabric.md", 0o600, "# inert smoke fixture steering\n"],
    ["resources/skills/fabric-exec/SKILL.md", 0o600, "# inert smoke fixture skill\n"],
    ["resources/skills/fabric-exec/references/inert.md", 0o600, "# inert smoke fixture reference\n"],
    ["notices/node-LICENSE", 0o600, "inert node notice\n"],
    ["notices/rg-LICENSE-MIT", 0o600, "inert rg mit notice\n"],
    ["notices/rg-COPYING", 0o600, "inert rg copying notice\n"],
    ["notices/rg-UNLICENSE", 0o600, "inert rg unlicense notice\n"],
    ["tools/node", 0o700, nodeShimSource(process.execPath, mode, token)],
    ["tools/rg", 0o700, rgShimSource(process.execPath)],
  ];
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const [relative, fileMode, body] of files) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, body, { mode: fileMode });
  }
  const nodeName = "node-v24.20.0-linux-x64";
  const rgName = "ripgrep-14.1.1-x86_64-unknown-linux-musl";
  const nodeBase = "https://nodejs.org/dist/v24.20.0/";
  const rgBase = "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/";
  const nodeUrl = nodeBase + nodeName + ".tar.gz";
  const rgUrl = rgBase + rgName + ".tar.gz";
  const tools = {
    node: { version: NODE_VERSION, url: nodeUrl, size: 1000, sha256: "a".repeat(64), checksumUrl: nodeBase + "SHASUMS256.txt", members: [
      { member: nodeName + "/bin/node", path: "tools/node", ...member(root, "tools/node") },
      { member: nodeName + "/LICENSE", path: "notices/node-LICENSE", ...member(root, "notices/node-LICENSE") },
    ] },
    rg: { version: RG_VERSION, url: rgUrl, size: 1000, sha256: "b".repeat(64), checksumUrl: rgUrl + ".sha256", members: [
      { member: rgName + "/rg", path: "tools/rg", ...member(root, "tools/rg") },
      { member: rgName + "/LICENSE-MIT", path: "notices/rg-LICENSE-MIT", ...member(root, "notices/rg-LICENSE-MIT") },
      { member: rgName + "/COPYING", path: "notices/rg-COPYING", ...member(root, "notices/rg-COPYING") },
      { member: rgName + "/UNLICENSE", path: "notices/rg-UNLICENSE", ...member(root, "notices/rg-UNLICENSE") },
    ] },
  };
  const manifest = await createBundleManifest(root, {
    version: "1.0.0", target: "linux-x64", compatibility: compatibilityFor("linux-x64", 1),
    provenance: { kind: "local-source", sourceDigest: "c".repeat(64), gitHead: null, dirty: false },
    tools, schema: 1,
  });
  fs.writeFileSync(path.join(root, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600 });
  return { root: fs.realpathSync(root), manifest, digest: manifest.digest, token, mode };
}
