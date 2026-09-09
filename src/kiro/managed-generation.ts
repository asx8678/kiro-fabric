import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateBundle } from "../installation/bundle-contract.mjs";
import { resolveSearchExecutable, type ManagedSearchExecutable } from "../providers/local-executable.js";

const digestPattern = /^[a-f0-9]{64}$/u;
export interface ManagedGenerationContext { bundleRoot: string; expectedNode: string; rg: string }

/** Layout evidence remains authoritative even when a cached profile loses env fields. */
export function inferManagedGeneration(runtimeRoot: string, env: NodeJS.ProcessEnv): ManagedGenerationContext | undefined {
  const parent = path.dirname(runtimeRoot);
  const completeLayout = path.basename(runtimeRoot) === "app" &&
    (fs.existsSync(path.join(parent, "bundle-manifest.json")) ||
      (digestPattern.test(path.basename(parent)) && path.basename(path.dirname(parent)) === "runtime" && path.basename(path.dirname(path.dirname(parent))) === "kiro-fabric"));
  if (!completeLayout && env.KIRO_FABRIC_BUNDLE_ROOT === undefined && env.KIRO_FABRIC_RG === undefined) return undefined;
  const bundleRoot = env.KIRO_FABRIC_BUNDLE_ROOT ?? parent;
  if (!path.isAbsolute(bundleRoot) || fs.realpathSync(bundleRoot) !== bundleRoot || runtimeRoot !== path.join(bundleRoot, "app")) throw new Error("managed generation runtime containment mismatch");
  const expectedNode = path.join(bundleRoot, "tools", "node");
  const rg = path.join(bundleRoot, "tools", "rg");
  if ((env.KIRO_FABRIC_EXPECTED_NODE !== undefined && env.KIRO_FABRIC_EXPECTED_NODE !== expectedNode) ||
      (env.KIRO_FABRIC_RG !== undefined && env.KIRO_FABRIC_RG !== rg)) throw new Error("managed generation executable environment mismatch");
  return { bundleRoot, expectedNode, rg };
}

export function managedInstallationBase(bundleRoot: string): string | undefined {
  const runtimes = path.dirname(bundleRoot);
  const base = path.dirname(runtimes);
  return digestPattern.test(path.basename(bundleRoot)) && path.basename(runtimes) === "runtime" && path.basename(base) === "kiro-fabric" ? base : undefined;
}

const hashBytes = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function readControl(file: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024 ||
      (stat.mode & 0o7777) !== 0o600 || (process.getuid && stat.uid !== process.getuid()) || fs.realpathSync(file) !== file) throw new Error("unsafe managed installation control");
  return fs.readFileSync(file);
}

/** Read-only admission decision. Caller holds the shared lock through data preparation. */
export function validateManagedAdmission(bundleRoot: string, dataRoot: string, manifestSha256: string): void {
  const base = managedInstallationBase(bundleRoot);
  if (!base) return; // Complete candidate, not an installed-layout bypass switch.
  if (dataRoot !== path.join(base, "data")) throw new Error("installed managed data binding mismatch");
  const ownerBytes = readControl(path.join(base, "install-owner.json"));
  const owner: unknown = JSON.parse(ownerBytes.toString("utf8"));
  const fields = ["owner", "schemaVersion", "status", "installationId", "kiroHome", "dataRoot", "currentRuntime", "previousRuntime", "runtimeGenerations", "profileSha256", "launcherSha256", "releaseStateSha256", "transactionId"];
  const nullableHash = (value: unknown): boolean => value === null || (typeof value === "string" && digestPattern.test(value));
  if (!record(owner) || fields.some(key => !Object.hasOwn(owner, key)) || Object.keys(owner).some(key => !fields.includes(key) && key !== "legacy") ||
      owner.owner !== "kiro-fabric-agent-user-install" || owner.schemaVersion !== 3 || !["active", "retired"].includes(String(owner.status)) ||
      typeof owner.installationId !== "string" || !owner.installationId || owner.installationId.length > 200 || /[\x00-\x1f\x7f]/u.test(owner.installationId) ||
      owner.kiroHome !== path.dirname(base) || owner.dataRoot !== dataRoot ||
      typeof owner.currentRuntime !== "string" || !digestPattern.test(owner.currentRuntime) || !nullableHash(owner.previousRuntime) ||
      !nullableHash(owner.profileSha256) || typeof owner.launcherSha256 !== "string" || !digestPattern.test(owner.launcherSha256) || !nullableHash(owner.releaseStateSha256) ||
      typeof owner.transactionId !== "string" || !/^[a-f0-9]{32}$/u.test(owner.transactionId) ||
      !Array.isArray(owner.runtimeGenerations) || !owner.runtimeGenerations.length || owner.runtimeGenerations.length > 256) throw new Error("invalid managed installation ownership");
  const names = new Set<string>();
  for (const generation of owner.runtimeGenerations) {
    if (!record(generation) || Object.keys(generation).sort().join(",") !== "manifestSha256,name" ||
        typeof generation.name !== "string" || !digestPattern.test(generation.name) || names.has(generation.name) ||
        typeof generation.manifestSha256 !== "string" || !digestPattern.test(generation.manifestSha256)) throw new Error("invalid retained generation ownership");
    names.add(generation.name);
  }
  if (!names.has(owner.currentRuntime) || (owner.previousRuntime !== null && !names.has(String(owner.previousRuntime)))) throw new Error("invalid current/previous generation ownership");
  if (owner.status !== "active") throw new Error("managed installation is retired; install before starting");
  if (!owner.runtimeGenerations.some(generation => generation.name === path.basename(bundleRoot) && generation.manifestSha256 === manifestSha256)) throw new Error("managed generation is not verified retained ownership");
  const journalPath = path.join(base, ".transactions", "active.json");
  let journalBytes: Buffer | undefined;
  try { journalBytes = readControl(journalPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (journalBytes) {
    const journal: unknown = JSON.parse(journalBytes.toString("utf8"));
    if (!record(journal) || journal.schemaVersion !== 1 || journal.transactionId !== owner.transactionId ||
        !nullableHash(journal.beforeOwnerSha256) || typeof journal.afterOwnerSha256 !== "string" ||
        !digestPattern.test(journal.afterOwnerSha256) || journal.afterOwnerSha256 !== hashBytes(ownerBytes)) throw new Error("managed installation requires transaction recovery before startup");
  }
  if (owner.releaseStateSha256 !== null && hashBytes(readControl(path.join(base, "release-state.json"))) !== owner.releaseStateSha256) throw new Error("managed release state identity mismatch");
}

/** Must run under the installation admission lock for installed generations. */
export async function validateManagedGeneration(context: ManagedGenerationContext, dataRoot: string): Promise<ManagedSearchExecutable> {
  if (context.expectedNode !== path.join(context.bundleRoot, "tools", "node")) throw new Error("managed generation containment mismatch");
  // Bracket the full cryptographic inventory capture with nanosecond metadata.
  // Its verified Node digest is reusable only if the named file stayed unchanged;
  // never cache this evidence across admissions or trust size/mtime alone.
  const beforeNode = fs.lstatSync(context.expectedNode, { bigint: true });
  const bundle = await validateBundle(context.bundleRoot);
  if (bundle.root !== context.bundleRoot || context.expectedNode !== path.join(bundle.root, "tools", "node") || context.rg !== path.join(bundle.root, "tools", "rg")) throw new Error("managed generation containment mismatch");
  const base = managedInstallationBase(bundle.root);
  if (base && (path.basename(bundle.root) !== bundle.digest || dataRoot !== path.join(base, "data"))) throw new Error("installed managed generation data binding mismatch");
  const relative = path.relative(bundle.root, dataRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) || bundle.root.startsWith(dataRoot + path.sep)) throw new Error("managed bundle and data roots overlap");
  const tools = bundle.manifest.tools as { node?: { version?: unknown }; rg?: { version?: unknown } };
  if (typeof tools.node?.version !== "string" || typeof tools.rg?.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(tools.node.version) || !/^\d+\.\d+\.\d+$/u.test(tools.rg.version)) throw new Error("managed tool version identity missing");
  const node = bundle.inventory.find((entry: { path: string }) => entry.path === "tools/node");
  const rg = bundle.inventory.find((entry: { path: string }) => entry.path === "tools/rg");
  const stat = fs.lstatSync(context.expectedNode, { bigint: true });
  const unchanged = (["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"] as const).every(key => beforeNode[key] === stat[key]);
  if (!node || !rg || !unchanged || fs.realpathSync(process.execPath) !== context.expectedNode || fs.realpathSync(context.expectedNode) !== context.expectedNode ||
      !stat.isFile() || stat.nlink !== 1n || (stat.mode & 0o7777n) !== 0o700n || (process.getuid && stat.uid !== BigInt(process.getuid())) ||
      stat.size !== BigInt(node.size) || process.version !== `v${tools.node.version}`) throw new Error("managed Node executable identity mismatch");
  const managedSearch: ManagedSearchExecutable = { generationRoot: bundle.root, path: context.rg, sha256: rg.sha256, mode: 0o700, version: `ripgrep ${tools.rg.version}` };
  resolveSearchExecutable(managedSearch);
  return managedSearch;
}
