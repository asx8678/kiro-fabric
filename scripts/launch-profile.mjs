import fs from "node:fs";
import path from "node:path";
import { generateAgentProfile } from "./agent-profile.mjs";
import { installerSafety } from "./install-agent-user.mjs";

/** Explicit launch selection, never a change to the managed default or its owner.
 * The caller must first admit an active, integrity-verified installation.
 * Retained generation-specific profiles also keep resumed chats reproducible.
 * @param {"standard" | "review" | "minimal"} [guidanceMode]
 */
export function prepareLaunchProfile(home, installation, guidanceMode = "standard") {
  if (!["standard", "review", "minimal"].includes(guidanceMode)) throw new Error("Invalid guidance mode");
  if (!path.isAbsolute(home) || installation.status !== "active" || !/^[a-f0-9]{64}$/u.test(installation.owner?.currentRuntime ?? "")) throw new Error("Active verified installation required for profile selection");
  const generation = installation.owner.currentRuntime;
  const root = path.join(home, "kiro-fabric", "runtime", generation);
  const name = guidanceMode === "standard" ? "kiro-fabric" : `kiro-fabric-${guidanceMode}-${generation.slice(0, 12)}`;
  const profile = generateAgentProfile({
    nodePath: path.join(root, "tools/node"), runtimeRoot: path.join(root, "app"),
    dataRoot: path.join(home, "kiro-fabric/data"),
    skillPath: path.join(root, "resources/skills/fabric-exec/SKILL.md"),
    steeringPath: path.join(root, "resources/steering/fabric.md"),
    bundleRoot: root, rgPath: path.join(root, "tools/rg"), guidanceMode,
  });
  profile.name = name;
  const declaration = JSON.stringify({ guidanceMode, profile: name, runtimeBundle: generation, prompt: profile.prompt,
    resources: profile.resources.map(content => ({ content })),
    hooks: profile.hooks.map(hook => ({ content: JSON.stringify(hook) })),
  });
  if (guidanceMode === "standard") return { name, mode: guidanceMode, created: false, declaration };
  const directory = path.join(home, "agents"), file = path.join(directory, `${name}.json`);
  installerSafety.assertSafeDirectory(directory, { private: true });
  const content = JSON.stringify(profile, null, 2) + "\n";
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    installerSafety.assertSafeFile(file, "selected launch profile");
    if (fs.statSync(file).size > 65536 || fs.readFileSync(file, "utf8") !== content) throw new Error("Selected launch profile already exists with different content; preserve it and resolve explicitly");
    return { name, mode: guidanceMode, path: file, created: false, declaration };
  }
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return { name, mode: guidanceMode, path: file, created: true, declaration };
}
