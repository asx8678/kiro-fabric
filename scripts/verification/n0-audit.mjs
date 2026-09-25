#!/usr/bin/env node
// N0 effects audit — reproducible scope
// See docs/browser-repair-containment-plan.md §14 (N0).
// Read-only audit; writes only into the private output directory.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonFlag = args.includes("--json");
const outIdx = args.indexOf("--out");
const outDir =
  outIdx >= 0 && outIdx + 1 < args.length
    ? path.resolve(args[outIdx + 1])
    : null;

// ── helpers ────────────────────────────────────────────────────────────────
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

function sha256File(abs) {
  const h = crypto.createHash("sha256");
  // Use O_NOFOLLOW: do not follow symlinks when reading
  let fd;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function safeStat(abs) {
  try {
    return fs.lstatSync(abs, { bigint: false });
  } catch {
    return null;
  }
}

function git(args, opts) {
  // Ignored stdout is null; preserve raw NUL-delimited output when captured.
  return execFileSync("git", ["--no-optional-locks", "--literal-pathspecs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    ...opts,
  }) ?? "";
}

const gitErrors = [];
function gitMaybe(args) {
  try {
    return git(args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    gitErrors.push({ args, status: error.status ?? null, code: error.code ?? null,
      message: String(error.stderr || error.message).slice(0, 2000) });
    return null;
  }
}

// null means unknown, never absent/clean. Inspection is bounded/read-only.
const gitHead = gitMaybe(["rev-parse", "--verify", "HEAD"])?.trimEnd() ?? "(unknown)";
const gitBranch = gitMaybe(["rev-parse", "--abbrev-ref", "HEAD"])?.trimEnd() ?? "(unknown)";
const gitStatusPorcelain = gitMaybe(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
const gitDirty = gitStatusPorcelain === null ? null : gitStatusPorcelain.length > 0;

function gitBlobHash(abs) {
  return gitMaybe(["hash-object", "--", abs])?.trimEnd() ?? null;
}

function headContainsPath(abs) {
  const rel = path.relative(ROOT, abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || gitHead === "(unknown)") return null;
  // A successful empty lookup establishes absence; a failed lookup does not.
  const out = gitMaybe(["ls-tree", "--full-tree", "--name-only", "-z", gitHead, "--", rel]);
  return out === null ? null : out.split("\0").includes(rel);
}

function trackedPath(abs) {
  const out = gitMaybe(["ls-files", "-z", "--", abs]);
  return out === null ? null : out.length > 0;
}

function fileStatus(abs) {
  if (gitStatusPorcelain === null) return "unknown";
  const rel = path.relative(ROOT, abs);
  const records = gitStatusPorcelain.split("\0");
  for (let i = 0; i < records.length; i++) {
    const line = records[i];
    if (!line) continue;
    const code = line.slice(0, 2);
    const original = /[RC]/.test(code) ? records[++i] : null;
    if (line.slice(3) === rel || original === rel) {
      if (code === "??") return "untracked";
      if (code.includes("U") || code === "AA" || code === "DD") return `status:${code}`;
      if (code.includes("R")) return "renamed";
      if (code.includes("D")) return "deleted";
      if (code.includes("A")) return "added";
      if (code.includes("M")) return "modified";
      return `status:${code}`;
    }
  }
  return "clean";
}

// ── import parsing ─────────────────────────────────────────────────────────
function parseRelativeImports(source) {
  const re = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|import\s*\(\s*|export\s+(?:[\s\S]*?\s+from\s+))["'](\.[^"']+)["']/g;
  const specs = [];
  for (;;) {
    const m = re.exec(source);
    if (!m) break;
    specs.push(m[1]);
  }
  return [...new Set(specs)];
}

function resolveImport(fromFile, specifier) {
  const dir = path.dirname(fromFile);
  // Check .mjs, .js, /index.mjs, /index.js
  const candidates = [
    path.resolve(dir, specifier),
    path.resolve(dir, specifier + ".mjs"),
    path.resolve(dir, specifier + ".js"),
    path.resolve(dir, specifier, "index.mjs"),
    path.resolve(dir, specifier, "index.js"),
  ];
  for (const c of candidates) {
    if (safeStat(c)?.isFile()) return c;
  }
  return null;
}

// ── effect scanning ────────────────────────────────────────────────────────
const EFFECT_PATTERNS = {
  "filesystem-mutation": [
    /\brmSync\b/,
    /\bunlinkSync\b/,
    /\bwriteFileSync\b/,
    /\bmkdirSync\b/,
    /\bmkdtempSync\b/,
    /\bchmodSync\b/,
    /\bchownSync\b/,
    /\brenameSync\b/,
    /\bcopyFileSync\b/,
    /\bsymlinkSync\b/,
    /\blinkSync\b/,
    /\btruncateSync\b/,
    /\bappendFileSync\b/,
    /\brmdirSync\b/,
    /\bfs\.writeFile\b/,
    /\bfs\.promises\.writeFile\b/,
    /\bfs\.rm\b/,
    /\bfs\.promises\.rm\b/,
    /\bfs\.unlink\b/,
    /\bfs\.promises\.unlink\b/,
    /\bfs\.rename\b/,
    /\bfs\.promises\.rename\b/,
    /\bfs\.mkdir\b/,
    /\bfs\.promises\.mkdir\b/,
    /\bfs\.chmod\b/,
    /\bfs\.promises\.chmod\b/,
    /\bfs\.copyFile\b/,
    /\bfs\.promises\.copyFile\b/,
    /\bfs\.openSync\([^)]*['"]w/,
    /\bfs\.openSync\([^)]*['"]a/,
    /\bfs\.open\([^)]*['"]w/,
    /\bfs\.open\([^)]*['"]a/,
    /\bcreateWriteStream\b/,
    /\bwritePinnedDirectoryStream\b/,
    /\bsyncDirectory\b/,
    /\bacquireInstallationLock\b/,
    /\bwriteBundleArchive\b/,
    /\bextractBundleArchive\b/,
    /\bwithInstallerArtifactLease\b/,
    /\bconfigurePullHook\b/,
    /\bstageSourceBundle\b/,
    /\bcaptureRegular\b/,
    /\breadRegular\b/,
    /\brunPinnedDirectoryOperation\b/,
    /\bwrite\b.*\bflag.*['"]w/,
  ],
  "process-spawn": [
    /\bspawnSync\b/,
    /\bspawn\b(?!Sync)/,
    /\bexecSync\b/,
    /\bexec\b(?!Sync|File)/,
    /\bexecFileSync\b/,
    /\bexecFile\b/,
    /\bfork\b/,
    /\bchild_process\b/,
  ],
};

function scanEffects(fileAbs, source) {
  if (!source) return [];
  const lines = source.split("\n");
  const rel = path.relative(ROOT, fileAbs);
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (const [kind, patterns] of Object.entries(EFFECT_PATTERNS)) {
      for (const pat of patterns) {
        if (pat.test(ln)) {
          sites.push({
            file: rel,
            line: i + 1,
            text: ln.trim().slice(0, 120),
            kind,
          });
          break; // one kind per line
        }
      }
    }
  }
  return sites;
}

// ── consumer scanning ──────────────────────────────────────────────────────
function findConsumerRefs(targetRel, content, fileRel) {
  if (!content) return [];
  const lines = content.split("\n");
  const refs = [];
  // Match the target basename or path in various contexts
  const base = path.basename(targetRel);
  const patterns = [
    new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
  ];
  // Also try with scripts/ prefix for targets
  if (targetRel.startsWith("scripts/")) {
    patterns.push(new RegExp(`\\b${targetRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (const pat of patterns) {
      if (pat.test(ln)) {
        refs.push({
          target: targetRel,
          file: fileRel,
          line: i + 1,
          text: ln.trim().slice(0, 120),
        });
        break;
      }
    }
  }
  return refs;
}

// ── main ───────────────────────────────────────────────────────────────────
const generatedAt = new Date().toISOString();
const outputRoot =
  outDir ??
  path.join(ROOT, ".tmp", "verification-n0", generatedAt.replace(/[:.]/g, "-"));

// Create output directory with mode 0o700
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });

// ── targets ────────────────────────────────────────────────────────────────
const TARGETS = [
  "scripts/source-install.mjs",
  "scripts/source-bundle-stage.mjs",
  "scripts/source-pull-hook.mjs",
];

const targets = [];
for (const t of TARGETS) {
  const abs = path.resolve(ROOT, t);
  const st = safeStat(abs);
  targets.push({
    path: t,
    exists: !!st?.isFile(),
    sha256: st?.isFile() ? sha256File(abs) : null,
    gitBlobHash: gitBlobHash(abs),
    headContainsPath: headContainsPath(abs),
    tracked: trackedPath(abs),
    status: fileStatus(abs),
  });
}

// ── imported helpers ───────────────────────────────────────────────────────
const importedHelpers = [];
const scopeIssues = [];
for (const t of TARGETS) {
  const abs = path.resolve(ROOT, t);
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (error) {
    scopeIssues.push({ file: path.relative(ROOT, abs), reason: "source unreadable", error: error.code ?? error.message });
    continue;
  }
  const specs = parseRelativeImports(source);
  for (const spec of specs) {
    const resolved = resolveImport(abs, spec);
    const rel = resolved ? path.relative(ROOT, resolved) : null;
    if (!rel) scopeIssues.push({ file: t, specifier: spec, reason: "unresolved local helper" });
    const st = resolved ? safeStat(resolved) : null;
    importedHelpers.push({
      from: t,
      specifier: spec,
      resolved: rel,
      exists: !!st?.isFile(),
      sha256: st?.isFile() ? sha256File(resolved) : null,
    });
  }
}

// ── effect sites ───────────────────────────────────────────────────────────
const effectScanFiles = new Set([
  ...TARGETS.map((t) => path.resolve(ROOT, t)),
  ...importedHelpers
    .filter((h) => h.resolved && h.exists)
    .map((h) => path.resolve(ROOT, h.resolved)),
]);

// Follow re-export shims one level for effect scanning
const reExportRe = /^export\s+\*\s+from\s+["'](\.[^"']+)["']/m;
const additionalScan = [];
for (const abs of [...effectScanFiles]) {
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (error) {
    scopeIssues.push({ file: path.relative(ROOT, abs), reason: "source unreadable", error: error.code ?? error.message });
    continue;
  }
  const m = reExportRe.exec(source);
  if (m) {
    const resolved = resolveImport(abs, m[1]);
    if (!resolved) scopeIssues.push({ file: path.relative(ROOT, abs), specifier: m[1], reason: "unresolved re-export shim" });
    if (resolved && !effectScanFiles.has(resolved)) {
      additionalScan.push(resolved);
    }
  }
}
for (const abs of additionalScan) effectScanFiles.add(abs);

const effectSites = [];
for (const abs of effectScanFiles) {
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (error) {
    scopeIssues.push({ file: path.relative(ROOT, abs), reason: "source unreadable", error: error.code ?? error.message });
    continue;
  }
  effectSites.push(...scanEffects(abs, source));
}

// ── consumers ──────────────────────────────────────────────────────────────
const CONSUMER_FILES = [
  "package.json",
  "install.sh",
  "knip.json",
];

// Add workflow files
let workflowDir;
try {
  workflowDir = path.join(ROOT, ".github", "workflows");
  for (const f of fs.readdirSync(workflowDir)) {
    if (f.endsWith(".yml") || f.endsWith(".yaml")) {
      CONSUMER_FILES.push(path.join(".github", "workflows", f));
    }
  }
} catch {
  scopeIssues.push({ file: ".github/workflows", reason: "workflow directory unavailable; consumers not enumerated" });
}

// Add plan doc
CONSUMER_FILES.push("docs/browser-repair-containment-plan.md");

const consumers = [];
for (const cf of CONSUMER_FILES) {
  const abs = path.resolve(ROOT, cf);
  let content;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch (error) {
    scopeIssues.push({ file: path.relative(ROOT, abs), reason: "source unreadable", error: error.code ?? error.message });
    continue;
  }
  for (const t of TARGETS) {
    consumers.push(...findConsumerRefs(t, content, cf));
  }
}

// ── uncertainties ──────────────────────────────────────────────────────────
const uncertainties = [
  "No external-API-compatibility proof: Regex import discovery and static references do not certify public API compatibility or dynamic/plugins/computed consumers",
  "No proof HEAD contained every deleted byte: the three targets were recovered from HEAD after bulk deletion, but unstaged edits or uncommitted changes before deletion cannot be verified",
  "No runtime/native qualification: this is a static source audit; no behavioral tests, browser integration, or native platform verification has been performed",
  "source-install.mjs delegates activation staging cleanup to source-staging-cleanup.mjs and reports retained staging; this static audit does not verify safety across every failure/recovery path",
  "The full drift/failure/commit/cleanup behavioral matrix from R1 is not verified by this audit",
  "Scope is incomplete: regex-discovered direct relative imports and a bounded shim pass are not a complete local helper graph; omitted imports and transitive effects must not be inferred absent",
];

// ── report ─────────────────────────────────────────────────────────────────
const report = {
  schemaVersion: 1,
  qualification: false,
  localDevelopmentOnly: true,
  generatedAt,
  root: ROOT,
  git: {
    head: gitHead,
    branch: gitBranch,
    dirty: gitDirty,
    errors: gitErrors,
  },
  scope: {
    complete: false,
    helperTraversal: "Direct relative import edges (including duplicates and unresolved edges); only the first export-star shim per file is followed, one level deep",
    limitations: "Regex heuristics, not AST analysis: transitive helpers, remaining re-exports, computed imports, require calls and non-relative local aliases may be omitted; no absence-of-effects or complete consumer claim",
    effectScanFiles: [...effectScanFiles].map((abs) => path.relative(ROOT, abs)),
    consumerScanFiles: CONSUMER_FILES,
    issues: scopeIssues,
  },
  targets,
  importedHelpers,
  effectSites,
  consumers,
  uncertainties,
};

// Write report to output directory with mode 0o600
const reportPath = path.join(outputRoot, "n0-audit.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });

// ── output ─────────────────────────────────────────────────────────────────
if (jsonFlag) {
  // JSON output to stdout
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  // Compact human summary
  const lines = [];
  lines.push("=== N0 Effects Audit ===");
  lines.push(`Generated:  ${generatedAt}`);
  lines.push(`Root:       ${ROOT}`);
  lines.push(`Git HEAD:   ${gitHead.slice(0, 12)}…  branch=${gitBranch}  dirty=${gitDirty ?? "unknown"}`);
  lines.push(`Output:     ${outputRoot}`);
  lines.push("Scope:      incomplete (heuristic, bounded static inspection)");
  lines.push(report.scope.helperTraversal);
  lines.push(report.scope.limitations);
  for (const issue of scopeIssues) lines.push(`Scope issue: ${JSON.stringify(issue)}`);
  for (const error of gitErrors) lines.push(`Git unknown: ${JSON.stringify(error)}`);
  lines.push("");
  lines.push("── Targets ──");
  for (const t of targets) {
    const icon = t.exists ? "✓" : "✗";
    const sha = t.sha256 ? t.sha256.slice(0, 16) + "…" : "(absent)";
    const gitb = t.gitBlobHash ? t.gitBlobHash.slice(0, 12) + "…" : "(unknown)";
    lines.push(`  ${icon} ${t.path}  sha256=${sha}  gitBlob=${gitb}  inHEAD=${t.headContainsPath ?? "unknown"}  tracked=${t.tracked ?? "unknown"}  status=${t.status}`);
  }
  lines.push("");
  lines.push(`── Imported Helpers (${importedHelpers.length}) ──`);
  for (const h of importedHelpers) {
    const icon = h.exists ? "✓" : "✗";
    lines.push(`  ${icon} ${h.from}  →  ${h.specifier}  →  ${h.resolved ?? "(unresolved)"}`);
  }
  lines.push("");
  lines.push(`── Effect Sites (${effectSites.length}) ──`);
  const byKind = {};
  for (const e of effectSites) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  }
  for (const [kind, count] of Object.entries(byKind)) {
    lines.push(`  ${kind}: ${count}`);
  }
  lines.push("");
  lines.push(`── Consumers (${consumers.length}) ──`);
  const consumerFiles = [...new Set(consumers.map((c) => c.file))];
  for (const cf of consumerFiles) {
    const count = consumers.filter((c) => c.file === cf).length;
    lines.push(`  ${cf}: ${count} reference(s)`);
  }
  lines.push("");
  lines.push(`── Uncertainties (${uncertainties.length}) ──`);
  for (let i = 0; i < uncertainties.length; i++) {
    lines.push(`  ${i + 1}. ${uncertainties[i]}`);
  }
  lines.push("");
  lines.push("Report written to: " + reportPath);

  process.stdout.write(lines.join("\n") + "\n");
}

// Exit success means report generation completed, not complete scope or qualification.
process.exitCode = 0;
