#!/usr/bin/env node
import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/kiro/management-entry.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
var invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
var selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  const { runInstalledManagement } = await import("../chunks/management-UDWV2HM7.js");
  process.exitCode = await runInstalledManagement(process.argv.slice(2));
}
