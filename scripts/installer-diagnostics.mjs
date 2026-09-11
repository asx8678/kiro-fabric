import fs from "node:fs";
import path from "node:path";
import { installerSafety as s } from "./install-agent-user.mjs";
import { captureBuildInputs, verifyBuildClosure } from "./build-inputs.mjs";
import { InstallerError, display, shellQuote, MANAGER_COMMANDS } from "./installer-cli-contract.mjs";

// Diagnostic metadata is data, never a module, executable or remembered checkout.
function readJson(file, expectedHash = undefined) {
  s.assertNoUnsafeSymlinkComponents(file);
  const before = s.assertSafeFile(file, "diagnostic metadata");
  if (before.nlink !== 1 || before.size > 2 * 1024 * 1024) throw new Error("Diagnostic metadata must be a bounded single-link file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) throw new Error("Diagnostic metadata changed during inspection");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error("Diagnostic metadata changed during inspection");
      offset += count;
    }
    const extra = fs.readSync(fd, Buffer.alloc(1), 0, 1, null), after = fs.fstatSync(fd);
    s.assertNoUnsafeSymlinkComponents(file);
    const current = s.assertSafeFile(file, "diagnostic metadata");
    if (extra || after.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || (expectedHash && s.hash(bytes) !== expectedHash)) throw new Error("Diagnostic metadata identity mismatch");
    return JSON.parse(bytes.toString("utf8"));
  } finally { fs.closeSync(fd); }
}
export function installedIdentity(installation) {
  const generation = installation?.generations?.find(value => value.digest === installation.owner?.currentRuntime);
  return { status: installation?.status ?? "unknown", generation: generation?.digest ?? null, version: generation?.version ?? null, provenance: generation?.manifest.provenance ?? { kind: "unknown" } };
}
export function installationGuidance(home, installation, { sourceRoot = undefined, source = false } = {}) {
  const identity = installedIdentity(installation), local = source || identity.provenance.kind === "local-source";
  const launcher = shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"));
  return { provenance: local ? "local-source" : identity.provenance.kind,
    commands: { start: `${launcher} start`, update: local ? `bash ${shellQuote(path.join(sourceRoot ?? "/path/to/checkout", "install.sh"))} --source --kiro-home ${shellQuote(home)} --yes` : `${launcher} update --yes`, doctor: `${launcher} doctor`, recover: `${launcher} recover --yes` },
    guidance: local ? "Source installation: explicitly select and review a trusted checkout, then run its --source installer. Installed update is the signed-release path; no remembered checkout is executed." : identity.provenance.kind === "release" ? "Signed-release installation: use installed update (signature verification remains mandatory)." : "Provenance is unknown. Choose a verified signed release or explicitly select a trusted source checkout; no checkout is inferred or executed.",
  };
}
export function inspectSourceComparison(home, sourceRoot, installation) {
  if (!path.isAbsolute(sourceRoot) || /[\u0000-\u001f\u007f]/u.test(sourceRoot)) throw new InstallerError("doctor --source-root requires a safe absolute path", 2, "usage");
  s.assertNoUnsafeSymlinkComponents(sourceRoot);
  s.assertSafeDirectory(sourceRoot);
  const root = fs.realpathSync(sourceRoot);
  if (root !== path.resolve(sourceRoot)) throw new Error("Source root is not canonical");
  const source = { root, status: "unavailable", sourceDigest: null, version: null, error: null };
  const build = { status: "unavailable-or-stale", sourceDigest: null, contentDigest: null, error: null };
  try {
    source.version = readJson(path.join(root, "package.json")).version ?? null;
    source.sourceDigest = captureBuildInputs(root).digest; source.status = "observed";
  } catch (error) { source.error = display(error.message); }
  try {
    const closure = path.join(root, "dist", "kiro-agent-closure");
    const record = readJson(path.join(closure, "closure-manifest.json"));
    build.sourceDigest = record.buildInputs?.digest ?? null; build.contentDigest = record.contentDigest ?? null;
    verifyBuildClosure(root, closure); build.status = "verified-current";
  } catch (error) { build.error = display(error.message); }
  const installed = { ...installedIdentity(installation), contentDigest: null, profileBindings: null };
  if (installation?.owner && installed.generation) {
    if (installation.status === "active") {
      const profile = readJson(path.join(home, "agents", "kiro-fabric.json"), installation.owner.profileSha256), server = profile.mcpServers?.fabric;
      installed.profileBindings = { command: server?.command ?? null, args: server?.args ?? null, runtimeRoot: server?.env?.KIRO_FABRIC_RUNTIME_ROOT ?? null, dataRoot: server?.env?.KIRO_FABRIC_DATA_ROOT ?? null, bundleRoot: server?.env?.KIRO_FABRIC_BUNDLE_ROOT ?? null, tools: profile.tools ?? null };
    }
    const generation = installation.generations.find(value => value.digest === installed.generation), entry = generation.inventory.find(value => value.path === "app/closure-manifest.json");
    if (entry) installed.contentDigest = readJson(path.join(generation.root, entry.path), entry.sha256).contentDigest ?? null;
  }
  const equal = (left, right) => left && right ? left === right ? "match" : "different" : "unknown";
  return { readOnly: true, source, build, installed, comparisons: { sourceToBuild: equal(source.sourceDigest, build.sourceDigest), sourceToInstalled: equal(source.sourceDigest, installed.provenance.sourceDigest), buildToInstalled: equal(build.status === "verified-current" ? build.contentDigest : null, installed.contentDigest) }, limitations: ["Explicit checkout inspected as data only; no git, package scripts, builds or installed mutations", "Matching local identities are not signed-release, native-client or authentication qualification"] };
}
export function previewManagerOperation(home, options, installation, { preparation = undefined, shellPlan = undefined, sourceRoot = undefined, source = false } = {}) {
  const command = MANAGER_COMMANDS[options.command];
  return { outcome: "planned", exitCode: 0, readOnly: true, committed: false, dataPreserved: true, command: options.command,
    scope: "Read-only preflight and operation scope, not a complete executable plan or admission guarantee",
    installation: installedIdentity(installation),
    plan: { confirmation: command.confirmation, configurationBackup: command.backup ? "required on execution; contents and exclusions not captured in preview" : "not created by this command", sourceRoot: sourceRoot ?? null, permissions: preparation?.permissions?.map(value => ({ path: value.path, previousMode: value.mode.toString(8), mode: "700" })) ?? [], legacyProfile: preparation?.legacy ?? null, shell: shellPlan ? { status: shellPlan.status, file: shellPlan.file ?? null, remove: shellPlan.remove ?? false, reason: shellPlan.reason ?? null } : null, backup: options.backup ?? null, target: options.archive ? { kind: "signed-archive", path: path.resolve(options.archive), verified: false } : options.version ? { kind: "signed-release", version: options.version, verified: false } : { kind: source ? "local-source" : ["install", "update"].includes(options.command) ? "signed-release" : "retained-evidence", identity: "unknown until execution" }, build: source ? "required by source frontend; not run; private-tool acquisition and target unknown" : "not performed by installed manager" },
    ...installationGuidance(home, installation, { sourceRoot, source }),
    warnings: ["No client probe, backup, restore replay, download, signature verification, build, permission change, shell write or transaction recovery was attempted", "Execution still validates ownership, backup completeness, locks, process fences and target identity; preview does not guarantee success"] };
}
