#!/usr/bin/env node
/**
 * V3 executable-claims harness. Drives only the built kiro-fabric CLI and its
 * managed runtime closure. Every probe is deterministic and non-billable.
 *
 * stdout: exactly one JSON document (KiroClaimsReport).
 * stderr: human diagnostics.
 *
 * `ok` is false unless every REQUIRED claim passes. This is a pre-release /
 * nightly gate and is deliberately NOT part of `pnpm check` / `prepack`.
 *
 * Usage: node scripts/certify-kiro-claims.mjs [--kiro-binary <path>] [--json <path>]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_KIRO_CLAIMS,
  buildKiroClaimsReport,
  fail,
  pass,
  skipped,
} from "../dist/kiro/index.js";
import { assertArtifactOutsideCheckout, pathIsInside } from "./certification/artifact-path.mjs";
import { captureGitBinding } from "./certification/git-binding.mjs";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "..");
const dist = resolve(here, "../dist");
const cli = resolve(dist, "kiro/cli-entry.js");
const mcpEntry = resolve(dist, "kiro/mcp-entry.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const log = (message) => process.stderr.write(`${message}\n`);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const walkRegularFiles = (root, prefix = "") => {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    const full = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkRegularFiles(full, rel));
    else if (entry.isFile()) files.push(rel);
    else files.push("!non-regular:" + rel);
  }
  return files.sort();
};
const attestManifestFiles = (project, files) => Array.isArray(files) && files.length > 0
  && files.every((file) => isRecord(file)
    && typeof file.path === "string"
    && typeof file.installedSha256 === "string"
    && existsSync(join(project, ...file.path.split("/")))
    && sha256(readFileSync(join(project, ...file.path.split("/")))) === file.installedSha256);

function surfaceOf(id) {
  const surface = id.split(".")[0];
  return ["pack", "doctor", "install", "mcp", "uninstall"].includes(surface) ? surface : "pack";
}

function runCliJson(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
  });
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    // Preserve process diagnostics below; malformed stdout is a failed probe.
  }
  return {
    ok: result.status === 0 && isRecord(data) && data.ok !== false,
    status: result.status,
    data,
    diagnostic: result.error?.message ?? result.stderr?.trim() ?? result.stdout?.trim() ?? "no process output",
  };
}

function allSkipped(dependency) {
  return REQUIRED_KIRO_CLAIMS.map((id) => skipped(
    id,
    surfaceOf(id),
    "dependency_failed",
    { dependency },
  ));
}

const packClaims = () => {
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  let entry;
  try {
    const parsed = JSON.parse(result.stdout);
    entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  } catch {
    // Report a deterministic failed claim below.
  }
  const files = new Set(Array.isArray(entry?.files)
    ? entry.files.map((file) => isRecord(file) ? file.path : undefined).filter((path) => typeof path === "string")
    : []);
  const required = [
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/kiro/cli-entry.js",
    "dist/kiro/mcp-entry.js",
    "dist/verification/index.js",
    "dist/verification/index.d.ts",
  ];
  const bannedPrefixes = ["src/", "tests/", "scripts/", "node_modules/"];
  const missing = required.filter((file) => !files.has(file));
  const banned = [...files].filter((file) => file.endsWith(".map")
    || bannedPrefixes.some((prefix) => file.startsWith(prefix)));
  const contentsOk = result.status === 0 && missing.length === 0 && banned.length === 0;

  const cliShebang = readFileSync(cli, "utf8").split("\n", 1)[0];
  const mcpShebang = readFileSync(mcpEntry, "utf8").split("\n", 1)[0];
  const entrypointsOk = contentsOk
    && pkg.bin?.["kiro-fabric"] === "./dist/kiro/cli-entry.js"
    && pkg.bin?.["kiro-fabric-mcp"] === "./dist/kiro/mcp-entry.js"
    && cliShebang === "#!/usr/bin/env node"
    && mcpShebang === "#!/usr/bin/env node";
  const diagnostic = result.error?.message || result.stderr?.trim() || "npm pack contents did not match policy";
  return [
    contentsOk
      ? pass("pack.contents", "pack", { fileCount: files.size, sourceMaps: 0 })
      : fail("pack.contents", "pack", `${diagnostic}; missing=${JSON.stringify(missing)} banned=${JSON.stringify(banned.slice(0, 20))}`),
    entrypointsOk
      ? pass("pack.entrypoints", "pack", { executableNodeShebangs: true, bins: Object.keys(pkg.bin ?? {}).sort() })
      : fail("pack.entrypoints", "pack", "published bins or executable Node shebangs are invalid"),
  ];
};

const checkStatuses = (report, ids) => Object.fromEntries(ids.map((id) => [
  id,
  report.checks.find((check) => isRecord(check) && check.id === id)?.status ?? "missing",
]));

const checkedClaim = (
  id,
  surface,
  report,
  requiredChecks,
  extraCondition = true,
  message = "required doctor checks did not pass",
  extraEvidence = {},
) => {
  const statuses = checkStatuses(report, requiredChecks);
  const passed = extraCondition && Object.values(statuses).every((status) => status === "pass");
  const evidence = { doctorOk: report.ok === true, checks: statuses, ...extraEvidence };
  return passed
    ? pass(id, surface, evidence)
    : fail(id, surface, message, "doctor-claim-not-met", evidence);
};

/** Convert a doctor report into doctor/MCP claims without trusting its exit code alone. */
export function claimsFromDoctorReport(value) {
  const checks = isRecord(value) && Array.isArray(value.checks) ? value.checks : [];
  const passed = checks.filter((check) => isRecord(check) && check.status === "pass").length;
  const failed = checks.filter((check) => isRecord(check) && check.status === "fail").length;
  const skippedCount = checks.filter((check) => isRecord(check) && check.status === "skipped").length;
  if (
    !isRecord(value)
    || value.kind !== "kiro-fabric.kiro-doctor"
    || value.schemaVersion !== 1
    || !Array.isArray(value.checks)
    || value.checks.some((check) => !isRecord(check)
      || typeof check.id !== "string"
      || !["pass", "fail", "skipped"].includes(check.status))
    || new Set(value.checks.map((check) => check.id)).size !== value.checks.length
    || !isRecord(value.summary)
    || value.summary.passed !== passed
    || value.summary.failed !== failed
    || value.summary.skipped !== skippedCount
    || value.ok !== (failed === 0)
  ) {
    return [
      fail("doctor.supported-tuple", "doctor", "doctor emitted a malformed report"),
      fail("doctor.profile-validation", "doctor", "doctor emitted a malformed report"),
      fail("doctor.non-billable", "doctor", "doctor emitted a malformed report"),
      fail("mcp.initialize", "mcp", "doctor emitted a malformed report"),
      fail("mcp.single-tool", "mcp", "doctor emitted a malformed report"),
      fail("mcp.golden-schema", "mcp", "doctor emitted a malformed report"),
      fail("mcp.fabric-exec", "mcp", "doctor emitted a malformed report"),
    ];
  }

  const nonBillable = value.ok === true
    && value.nonBillable === true
    && value.modelTurnsRequested === 0;
  return [
    checkedClaim("doctor.supported-tuple", "doctor", value, ["tuple"]),
    checkedClaim(
      "doctor.profile-validation",
      "doctor",
      value,
      ["profile.shape", "profile.validate", "profile.negative-control"],
    ),
    checkedClaim(
      "doctor.non-billable",
      "doctor",
      value,
      ["acp.initialize", "acp.session-new", "acp.no-prompt", "acp.shutdown"],
      nonBillable,
      "doctor failed or did not prove a zero-turn ACP lifecycle",
      {
        nonBillable: value.nonBillable === true,
        modelTurnsRequested: value.modelTurnsRequested,
      },
    ),
    checkedClaim("mcp.initialize", "mcp", value, ["mcp.initialize"]),
    checkedClaim("mcp.single-tool", "mcp", value, ["mcp.tools-list"]),
    checkedClaim("mcp.golden-schema", "mcp", value, ["mcp.tools-list"]),
    checkedClaim("mcp.fabric-exec", "mcp", value, ["mcp.fabric-exec"]),
  ];
}

export const lifecycleClaims = (kiroBinary) => {
  const work = mkdtempSync(join(tmpdir(), "kiro-claims-"));
  const project = join(work, "project");
  const sibling = join(project, ".kiro", "agents", "other.json");
  mkdirSync(dirname(sibling), { recursive: true });
  writeFileSync(sibling, `${JSON.stringify({ name: "other" })}\n`, { mode: 0o600 });

  try {
    const installed = runCliJson([
      "install", "kiro",
      "--project-root", project,
      "--kiro-binary", kiroBinary,
      "--json",
    ]);
    const data = installed.data;
    let managedProfile = installed.ok
      && data.action === "create"
      && data.dryRun === false
      && typeof data.profilePath === "string"
      && typeof data.manifestPath === "string"
      && pathIsInside(project, data.profilePath)
      && pathIsInside(project, data.manifestPath)
      && existsSync(data.profilePath)
      && existsSync(data.manifestPath)
      && typeof data.profileSha256 === "string"
      && /^[a-f0-9]{64}$/.test(data.profileSha256);
    const closure = isRecord(data?.runtimeClosure) ? data.runtimeClosure : {};
    let manifest = {};
    try {
      manifest = JSON.parse(readFileSync(data.manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
    const skills = isRecord(manifest.skills) ? manifest.skills : {};
    const skillAttestation = manifest.format === 2
      && typeof skills.bundleSha256 === "string"
      && /^[a-f0-9]{64}$/.test(skills.bundleSha256)
      && Array.isArray(skills.files)
      && skills.files.length === 6
      && attestManifestFiles(project, skills.files);
    const runtime = isRecord(manifest.runtime) ? manifest.runtime : {};
    const closureManifest = isRecord(runtime.closure) ? runtime.closure : {};
    const closureRoot = typeof closureManifest.root === "string"
      ? join(project, ...closureManifest.root.split("/"))
      : "";
    const closureFileSet = Array.isArray(closureManifest.files)
      ? closureManifest.files.map((file) => file.path.slice(closureManifest.root.length + 1))
      : [];
    const runtimeClosure = managedProfile
      && skillAttestation
      && typeof closure.mcpEntryPath === "string"
      && pathIsInside(project, closure.mcpEntryPath)
      && existsSync(closure.mcpEntryPath)
      && typeof closure.digest === "string"
      && /^[a-f0-9]{64}$/.test(closure.digest)
      && closureManifest.digest === closure.digest
      && closureRoot !== ""
      && existsSync(closureRoot)
      && attestManifestFiles(project, closureManifest.files)
      && JSON.stringify(walkRegularFiles(closureRoot)) === JSON.stringify(closureFileSet);

    managedProfile = managedProfile && skillAttestation;

    const claims = [
      managedProfile
        ? pass("install.managed-profile", "install", { action: data.action, profileSha256: data.profileSha256 })
        : fail("install.managed-profile", "install", `managed profile install failed: ${installed.diagnostic}`),
      runtimeClosure
        ? pass("install.runtime-closure", "install", { digest: closure.digest, updated: closure.updated === true })
        : fail("install.runtime-closure", "install", `runtime closure was not deployed: ${installed.diagnostic}`),
    ];

    if (!managedProfile) {
      claims.push(
        skipped("uninstall.hash-owned", "uninstall", "dependency_failed", { dependency: "install.managed-profile" }),
        skipped("uninstall.preserves-siblings", "uninstall", "dependency_failed", { dependency: "install.managed-profile" }),
        skipped("uninstall.idempotent", "uninstall", "dependency_failed", { dependency: "install.managed-profile" }),
      );
      return claims;
    }

    const originalProfile = readFileSync(data.profilePath, "utf8");
    const driftedProfile = `${originalProfile}\n`;
    writeFileSync(data.profilePath, driftedProfile, "utf8");
    const refused = runCliJson(["uninstall", "kiro", "--project-root", project, "--json"]);
    const hashOwned = refused.status === 1
      && isRecord(refused.data?.error)
      && refused.data.error.code === "ownership"
      && readFileSync(data.profilePath, "utf8") === driftedProfile
      && existsSync(data.manifestPath);
    claims.push(hashOwned
      ? pass("uninstall.hash-owned", "uninstall", { refusedDrift: true })
      : fail("uninstall.hash-owned", "uninstall", `uninstall did not refuse modified managed bytes: ${refused.diagnostic}`));

    // The harness owns this disposable project and restores its exact fixture
    // bytes so the successful uninstall path can be tested independently.
    writeFileSync(data.profilePath, originalProfile, "utf8");
    const removed = runCliJson(["uninstall", "kiro", "--project-root", project, "--json"]);
    const preservesSibling = removed.ok
      && removed.data.action === "remove"
      && !existsSync(data.profilePath)
      && existsSync(sibling);
    claims.push(preservesSibling
      ? pass("uninstall.preserves-siblings", "uninstall", { action: removed.data.action })
      : fail("uninstall.preserves-siblings", "uninstall", `uninstall removed unrelated state or failed: ${removed.diagnostic}`));

    const second = runCliJson(["uninstall", "kiro", "--project-root", project, "--json"]);
    claims.push(second.ok && second.data.action === "noop"
      ? pass("uninstall.idempotent", "uninstall", { action: second.data.action })
      : fail("uninstall.idempotent", "uninstall", `second uninstall was not a no-op: ${second.diagnostic}`));
    return claims;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      fail("install.managed-profile", "install", `lifecycle probe crashed: ${message}`),
      fail("install.runtime-closure", "install", `lifecycle probe crashed: ${message}`),
      skipped("uninstall.hash-owned", "uninstall", "dependency_failed", { dependency: "lifecycle probe" }),
      skipped("uninstall.preserves-siblings", "uninstall", "dependency_failed", { dependency: "lifecycle probe" }),
      skipped("uninstall.idempotent", "uninstall", "dependency_failed", { dependency: "lifecycle probe" }),
    ];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--kiro-binary" && flag !== "--json") {
      throw new Error(`unknown argument: ${flag}`);
    }
    const key = flag === "--kiro-binary" ? "kiroBinary" : "jsonPath";
    if (options[key] !== undefined) throw new Error(`${flag} may be specified only once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    options[key] = flag === "--json" ? resolve(value) : value;
    index += 1;
  }
  return options;
}

const emitReport = (claims, jsonPath) => {
  const report = {
    ...buildKiroClaimsReport(claims),
    identity: captureGitBinding(root),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (jsonPath) writeFileSync(jsonPath, json, { mode: 0o600 });
  process.stdout.write(json);
  return report.ok ? 0 : 1;
};

export function main(argv = process.argv.slice(2)) {
  const { kiroBinary, jsonPath } = parseArgs(argv);
  assertArtifactOutsideCheckout(root, jsonPath, "--json");
  if (!existsSync(cli) || !existsSync(mcpEntry)) {
    return emitReport(allSkipped("dist not built"), jsonPath);
  }

  const claims = packClaims();

  if (!kiroBinary) {
    log("doctor/install — requires a real Kiro binary; use --kiro-binary <path>");
    claims.push(...REQUIRED_KIRO_CLAIMS
      .filter((id) => !claims.some((claim) => claim.id === id))
      .map((id) => skipped(id, surfaceOf(id), "unavailable", { dependency: "no kiro binary" })));
    return emitReport(claims, jsonPath);
  }

  const doctor = runCliJson(["doctor", "kiro", "--kiro-binary", kiroBinary, "--json"]);
  claims.push(...claimsFromDoctorReport(doctor.data));
  claims.push(...lifecycleClaims(kiroBinary));
  return emitReport(claims, jsonPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("Usage: node scripts/certify-kiro-claims.mjs [--kiro-binary <path>] [--json <path>]\n");
    process.exitCode = 2;
  }
}
