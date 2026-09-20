// Short-lived native hook entry. No engine, credentials, cwd-based session
// guessing, private RPC, or filesystem rendezvous is permitted here.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { foveaHookCapability } from "./fovea-native.js";
export { foveaHookCapability, type FoveaHookCapability } from "./fovea-native.js";

// Kiro TUI forwards successful hook stdout into context. Never emit a status
// report on that channel by default: it is not an advisory or a delivery receipt.
// Real TUI stdin has session_id, but native MCP initialize/tools/call does not
// carry that identity. Cwd, tool arguments and process ancestry cannot bridge it.
export function runFoveaHook(argv = process.argv.slice(2)): number {
  if (argv.length === 1 && argv[0] === "--status") {
    process.stdout.write(JSON.stringify(foveaHookCapability()) + "\n");
    return 0;
  }
  process.stderr.write("Fovea automatic hooks disabled: no supported native session-to-MCP association. Use --status for diagnostics.\n");
  return 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runFoveaHook();
}
