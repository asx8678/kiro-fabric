#!/usr/bin/env node
// Source/built W7 identity and exports. Not installer or native qualification.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function verifyBuiltInventory(root, expectedInventory) {
  const api = await import(pathToFileURL(path.join(root, "dist/index.js")).href);
  const inventory = api.FABRIC_RUNTIME_PROVIDER_INVENTORY;
  assert.ok(Array.isArray(inventory), "built runtime inventory missing; rebuild");
  if (expectedInventory) assert.deepEqual(inventory, expectedInventory, "source/built inventory differs");
  const expected = ["artifacts", "continuity", "fabric", "local", "mcp", "memory", "probe", "repo", "review", "state"];
  assert.deepEqual(inventory.map(entry => entry.name).sort(), expected);
  assert.deepEqual([...api.FABRIC_RUNTIME_PROVIDER_NAMES].sort(), expected);
  assert.deepEqual(Object.keys(api.FABRIC_RUNTIME_PROVIDER_REQUIREMENTS).sort(), expected);
  const declarations = fs.readFileSync(path.join(root, "dist/index.d.ts"), "utf8");
  assert.match(declarations, /\bFabricProviderRequirements\b/u);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"), "utf8"));
  const sources = ["src/index.ts", "src/protocol.ts", "src/kiro/provider-inventory.ts", "src/kiro/runtime.ts",
    "src/core/action-registry.ts", "src/kiro/memory-provider.ts", "src/providers/state-provider.ts",
    "src/providers/review-provider.ts", "src/providers/probe-provider.ts", "src/providers/continuity-provider.ts", "src/kiro/mcp-provider.ts"];
  for (const source of sources) {
    const input = manifest.buildInputs.files.find(file => file.path === source);
    assert.ok(input, "missing W7 build input: " + source);
    assert.equal(input.sha256, createHash("sha256").update(fs.readFileSync(path.join(root, source))).digest("hex"), "stale W7 build input: " + source);
  }
  return { providerCount: inventory.length, sourceInputs: sources, builtExports: 3, rootTypeDeclared: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const facts = await verifyBuiltInventory(root);
  process.stdout.write(JSON.stringify({ ok: true, ...facts }) + "\n");
}
