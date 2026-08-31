import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  resolveKiroProjectRoot,
  verifyCanonicalKiroProjectRootIdentity
} from "./chunk-PJTPG7SK.js";
import "./chunk-GX475RD4.js";

// src/kiro/mcp-environment.ts
import path2 from "node:path";

// src/kiro/integration-mode.ts
var KIRO_INTEGRATION_MODES = [
  "power",
  "strict",
  "internal-child"
];
var isKiroIntegrationMode = (value) => typeof value === "string" && KIRO_INTEGRATION_MODES.includes(value);
var parseKiroIntegrationMode = (value, source = "Kiro integration mode") => {
  if (!isKiroIntegrationMode(value)) {
    const rendered = typeof value === "string" ? JSON.stringify(value) : String(value);
    throw new Error(
      `${source} must be one of power, strict, or internal-child; received ${rendered}`
    );
  }
  return value;
};

// src/kiro/power/launch-context.ts
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
var canonicalDirectory = (value, name) => {
  if (!value) throw new Error(`Power launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  const resolved = path.resolve(value);
  let lexical;
  let canonical;
  try {
    lexical = lstatSync(resolved);
    canonical = realpathSync(resolved);
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${error.message}`);
  }
  if (!lexical.isDirectory() || lexical.isSymbolicLink() || canonical !== resolved || !statSync(canonical).isDirectory()) {
    throw new Error(`${name} must be a canonical, non-symlink directory`);
  }
  return canonical;
};
var resolveKiroPowerLaunchContext = (env = process.env) => {
  const pluginRoot = canonicalDirectory(env.PLUGIN_ROOT, "PLUGIN_ROOT");
  const pluginData = canonicalDirectory(env.PLUGIN_DATA, "PLUGIN_DATA");
  if (pluginRoot === pluginData) throw new Error("PLUGIN_ROOT and PLUGIN_DATA must be different directories");
  const dataInRoot = path.relative(pluginRoot, pluginData);
  if (dataInRoot && dataInRoot !== ".." && !dataInRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(dataInRoot)) {
    throw new Error("PLUGIN_DATA must not be nested inside immutable PLUGIN_ROOT");
  }
  return { mode: "power", pluginRoot, pluginData };
};

// src/kiro/mcp-environment.ts
var resolveKiroMcpLaunchEnvironment = (env = process.env, processCwd = process.cwd()) => {
  const explicitIntegration = env.KIRO_FABRIC_INTEGRATION;
  if (explicitIntegration !== void 0) {
    const mode = parseKiroIntegrationMode(explicitIntegration, "KIRO_FABRIC_INTEGRATION");
    if (mode === "power") return resolveKiroPowerLaunchContext(env);
    if (mode === "internal-child" && env.KIRO_FABRIC_PROFILE_KIND !== "internal-child") {
      throw new Error("internal-child integration requires the isolated internal-child profile");
    }
    if (mode === "strict" && env.KIRO_FABRIC_PROFILE_KIND === "internal-child") {
      throw new Error("strict integration cannot launch an internal-child profile");
    }
  }
  const profileKind = env.KIRO_FABRIC_PROFILE_KIND;
  if (profileKind !== void 0 && profileKind !== "managed-main" && profileKind !== "strict" && profileKind !== "internal-child") {
    throw new Error(`unknown KIRO_FABRIC_PROFILE_KIND ${JSON.stringify(profileKind)}`);
  }
  if (profileKind !== "internal-child") {
    const configuredRoot = env.KIRO_FABRIC_PROJECT_ROOT;
    const confined = env.KIRO_FABRIC_ENFORCE_PROJECT_ROOT === "1" || env.KIRO_FABRIC_ALLOW_SHELL === "1" || env.KIRO_FABRIC_ENABLE_SUBAGENTS === "1" || env.KIRO_FABRIC_ALLOW_TOOLS === "1";
    let cwd2;
    try {
      cwd2 = resolveKiroProjectRoot(processCwd);
    } catch {
      cwd2 = resolveKiroProjectRoot(
        configuredRoot ?? processCwd
      );
    }
    if (confined) {
      if (!configuredRoot) {
        throw new Error(
          "trusted Kiro profile is missing its canonical project root; reinstall the profile with --project-root"
        );
      }
      const expectedDev = env.KIRO_FABRIC_PROJECT_ROOT_DEV;
      const expectedIno = env.KIRO_FABRIC_PROJECT_ROOT_INO;
      if (!expectedDev || !expectedIno) {
        throw new Error(
          "trusted Kiro profile is missing its project identity; reinstall the profile"
        );
      }
      const root = verifyCanonicalKiroProjectRootIdentity(configuredRoot, {
        dev: expectedDev,
        ino: expectedIno
      }).root;
      const relative = path2.relative(root, cwd2);
      if (relative === ".." || relative.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative)) {
        throw new Error(
          `trusted Kiro profile is confined to ${root}; launching kiro-cli from ${cwd2} is outside that project. Run kiro-cli from inside ${root} (or a subdirectory of it), or reinstall the profile (kiro-fabric install kiro --user --project-root "${root}") for a different project.`
        );
      }
    }
    return { mode: "strict", cwd: cwd2, kind: "managed-main" };
  }
  const childCwd = env.KIRO_FABRIC_CWD;
  const toolsEnv = env.KIRO_FABRIC_KIRO_TOOLS;
  if (!childCwd || toolsEnv === void 0) {
    throw new Error("internal Kiro child profile is missing its canonical cwd or tool scope");
  }
  const cwd = resolveKiroProjectRoot(childCwd);
  return { mode: "internal-child", cwd, toolsEnv, kind: "internal-child" };
};
export {
  resolveKiroMcpLaunchEnvironment
};
