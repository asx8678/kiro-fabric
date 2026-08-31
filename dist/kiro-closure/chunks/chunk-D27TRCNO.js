import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/core/pi-tools.ts
var PI_CORE_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls"
];
var PI_CORE_TOOL_NAME_SET = new Set(PI_CORE_TOOL_NAMES);

export {
  PI_CORE_TOOL_NAMES
};
