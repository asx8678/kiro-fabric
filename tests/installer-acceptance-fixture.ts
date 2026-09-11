import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonical, compatibilityFor, createBundleManifest, REQUIRED_APP } from "../scripts/bundle-contract.mjs";
import { fixtureTools } from "./bundle-fixture.js";
import { installerSmokeCode } from "../scripts/installer-smoke-contract.mjs";

// Test-only MCP peer, with a real private Node binary (>64MiB), not a build-failure
// stub. Product smoke validates inventory/structured results over real stdio.
export async function acceptanceBundle(root: string, behavior: "success" | "empty-search" | "extra-tool" | "out-of-order") {
  fs.mkdirSync(root, { mode: 0o700 });
  const target = `${process.platform}-${process.arch}`, tools = fixtureTools(target);
  for (const relative of [...REQUIRED_APP, "app/main.js", ...Object.values(tools).flatMap(pin => pin.members.map(member => member.path)), "manager/install-manager.mjs", "resources/steering/fabric.md", "resources/skills/fabric-exec/SKILL.md", "resources/skills/fabric-exec/references/api.md"]) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `fixture ${relative}`, { mode: relative.startsWith("tools/") ? 0o700 : 0o600 });
  }
  fs.writeFileSync(path.join(root, "app/package.json"), JSON.stringify({ type: "commonjs" }), { mode: 0o600 });
  fs.copyFileSync(process.execPath, path.join(root, "tools/node")); fs.chmodSync(path.join(root, "tools/node"), 0o700);
  fs.writeFileSync(path.join(root, "tools/rg"), '#!/bin/sh\nprintf "ripgrep 14.1.1\\n"\n', { mode: 0o700 });
  for (const pin of Object.values(tools)) for (const member of pin.members) {
    const bytes = fs.readFileSync(path.join(root, member.path)); member.size = bytes.length; member.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  fs.writeFileSync(path.join(root, "app/kiro/mcp-entry.js"), `
const fs = require('node:fs');
const lines = require('node:readline').createInterface({input: process.stdin});
lines.on('line', line => {
 const request = JSON.parse(line); let result;
 if(request.method === 'initialize') result = {capabilities:{}};
 else if(request.method === 'tools/list') result = {tools:${JSON.stringify(behavior === "extra-tool" ? ["fabric_info", "fabric_workspace", "fabric_exec", "unexpected"] : ["fabric_info", "fabric_workspace", "fabric_exec"])}.map(name=>({name}))};
 else if(request.method === 'tools/call') {
  if(request.params.name !== 'fabric_exec' || request.params.arguments.code !== ${JSON.stringify(installerSmokeCode)} || request.params.arguments.resultFormat !== 'json') throw Error('fixture expected exact typed smoke request');
  const text = fs.readFileSync('probe.txt','utf8');
  const value = {read:{path:'probe.txt',text,totalLines:1,truncated:false},search:{matches:${behavior === "empty-search" ? "[]" : "[{path:'probe.txt',line:1,text:text.trimEnd()}]"},truncated:false}};
  result = {content:[{type:'text',text:JSON.stringify(value)}]};
 }
 if(result) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:${behavior === "out-of-order" ? "3" : "request.id"},result})+'\\n');
});
`, { mode: 0o600 });
  const manifest = await createBundleManifest(root, { version: "1.0.0", target, compatibility: compatibilityFor(target), provenance: { kind: "local-source", sourceDigest: "a".repeat(64), gitHead: null, dirty: true }, tools });
  fs.writeFileSync(path.join(root, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600 });
  return { root, manifest };
}
