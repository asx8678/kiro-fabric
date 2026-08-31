import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/kiro/deadlines.ts
var KIRO_EXECUTION_TIMEOUT_MS = 9e5;
var KIRO_MCP_CALL_TIMEOUT_MS = 93e4;
var KIRO_MCP_DRAIN_TIMEOUT_MS = 5e3;

export {
  KIRO_EXECUTION_TIMEOUT_MS,
  KIRO_MCP_CALL_TIMEOUT_MS,
  KIRO_MCP_DRAIN_TIMEOUT_MS
};
