#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root=fs.realpathSync(path.resolve("."));
const data=path.join(root,".tmp","agent-dev-data");
fs.mkdirSync(data,{recursive:true,mode:0o700});
process.env.KIRO_FABRIC_RUNTIME_ROOT=path.join(root,"dist","kiro-agent-closure");
process.env.KIRO_FABRIC_DATA_ROOT=data;
const entry=new URL("../dist/kiro-agent-closure/kiro/mcp-entry.js",import.meta.url).href;
const {runKiroMcpProcess}=await import(entry);
process.exit(await runKiroMcpProcess());
