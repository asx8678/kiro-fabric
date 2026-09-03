#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const data = path.join(repoRoot, ".tmp", "agent-dev-data");
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
process.env.KIRO_FABRIC_RUNTIME_ROOT = path.join(repoRoot, "dist", "kiro-agent-closure");
process.env.KIRO_FABRIC_DATA_ROOT = data;
const entry = new URL("../../dist/kiro-agent-closure/kiro/mcp-entry.js", import.meta.url).href;
const { runKiroMcpProcess } = await import(entry);
process.exit(await runKiroMcpProcess());
