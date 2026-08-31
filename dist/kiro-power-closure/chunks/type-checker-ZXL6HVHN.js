import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  DEFAULT_COMPILER_TIMEOUT_MS,
  normalizeTypeScriptPath,
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCode,
  typeCheckFabricCodeInWorker,
  wrapFabricGuestCode
} from "./chunk-MMKAFZEV.js";
import "./chunk-GX475RD4.js";
export {
  DEFAULT_COMPILER_TIMEOUT_MS,
  normalizeTypeScriptPath,
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCode,
  typeCheckFabricCodeInWorker,
  wrapFabricGuestCode
};
