import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  normalizeTypeScriptPath,
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCode,
  wrapFabricGuestCode
} from "./chunk-7W2AG64Q.js";
import "./chunk-GX475RD4.js";
export {
  normalizeTypeScriptPath,
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCode,
  wrapFabricGuestCode
};
