#!/usr/bin/env node
// Offline reference audit: prove package scripts, workflow commands, install.sh,
// knip entries and qualification command names all point at real files and real
// registrations. Read-only: it never imports or evaluates a scanned script and
// never touches the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 8000;
const MAX_TEXT = 4 * 1024 * 1024;
const QUALIFICATION_SCRIPT = "scripts/qualification-unavailable.mjs";
const FILE_TOKEN = /^(?:\.{0,2}\/)?(?:scripts|src|tests|docs|skills)\/[A-Za-z0-9._/-]+$/u;
const ROOT_SH_TOKEN = /^(?:\.\/)?[A-Za-z0-9._-]+\.(?:sh|mjs|js)$/u;
const REQUIRED_ENTRYPOINTS = [
  "install.sh",
  "scripts/source-install.mjs",
  "scripts/build.mjs",
  "scripts/build-kiro-closure.mjs",
  "scripts/qualification-unavailable.mjs",
];

// pnpm subcommands that are not package script names.
const PNPM_BUILTINS = new Set([
  "install", "exec", "dlx", "add", "remove", "update", "import", "rebuild", "prune",
  "audit", "licenses", "list", "why", "outdated", "publish", "pack", "deploy", "store",
  "config", "init", "link", "unlink", "patch", "dedupe", "fetch", "root", "bin", "env",
  "doctor", "setup", "approve-builds", "rebuild",
]);

/** @param {string} text @returns {string[]} */
function tokens(text) {
  return text
    .split(/[\s;|&()<>]+/u)
    .map((token) => token.replace(/^["']/u, "").replace(/["']$/u, ""))
    .filter((token) => token !== "");
}

/** @param {string} text @returns {string[]} */
function fileTokens(text) {
  return tokens(text).filter((token) => FILE_TOKEN.test(token) || ROOT_SH_TOKEN.test(token));
}

/** @param {string} text @returns {string[]} */
function qualificationIds(text) {
  const pattern = /node\s+(?:\S*\/)?scripts\/qualification-unavailable\.mjs\s+([A-Za-z0-9._-]+)/gu;
  /** @type {string[]} */
  const ids = [];
  for (const match of text.matchAll(pattern)) ids.push(match[1]);
  return ids;
}

/** @param {string} file @returns {string} */
function readText(file) {
  const stats = fs.statSync(file);
  if (stats.size > MAX_TEXT) throw new Error("reference audit text bound exceeded: " + file);
  return fs.readFileSync(file, "utf8");
}

/** @param {string} root @param {string} token */
function resolveToken(root, token) {
  return path.resolve(root, token.replace(/^\.\//u, ""));
}

/** @param {string} kind @param {string} target @param {string} source */
function finding(kind, target, source) {
  return { kind, target, source };
}

/** @param {string} text @returns {Set<string>} */
function reasonIds(text) {
  /** @type {Set<string>} */
  const ids = new Set();
  const start = text.indexOf("const reasons = {");
  if (start === -1) return ids;
  const end = text.indexOf("};", start);
  if (end === -1) return ids;
  for (const match of text.slice(start, end).matchAll(/"([A-Za-z0-9._-]+)"\s*:/gu)) ids.add(match[1]);
  return ids;
}

/** @param {string} root @param {any[]} findings @param {any[]} notices */
function checkPackageScripts(root, findings, notices) {
  const manifest = JSON.parse(readText(path.join(root, "package.json")));
  const scripts = manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
  const names = new Set(Object.keys(scripts));
  let fileTargets = 0;
  let scriptRefs = 0;
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") { findings.push(finding("invalid-script", name, "package.json")); continue; }
    for (const token of fileTokens(command)) {
      fileTargets += 1;
      if (!fs.existsSync(resolveToken(root, token))) findings.push(finding("missing-script-target", token, "package.json:" + name));
    }
    for (const match of command.matchAll(/pnpm\s+(?:run\s+)?([A-Za-z0-9:@._/-]+)/gu)) {
      const referenced = match[1];
      scriptRefs += 1;
      if (names.has(referenced)) continue;
      if (PNPM_BUILTINS.has(referenced)) { notices.push({ kind: "pnpm-builtin", target: referenced, source: "package.json:" + name }); continue; }
      findings.push(finding("unknown-script", referenced, "package.json:" + name));
    }
  }
  return { names, count: names.size, fileTargets, scriptRefs };
}

/** Minimal glob support for entry patterns such as "src/fovea/core/*.ts". */
/** @param {string} root @param {string} pattern */
function globMatches(root, pattern) {
  const slash = pattern.lastIndexOf("/");
  const dir = slash === -1 ? "." : pattern.slice(0, slash);
  const base = pattern.slice(slash + 1);
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) return 0;
  const escaped = base.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*").replace(/\?/gu, "[^/]");
  const expression = new RegExp("^" + escaped + "$", "u");
  return fs.readdirSync(absolute).filter((entry) => expression.test(entry)).length;
}

/** @param {string} root @param {any[]} findings */
function checkKnipEntries(root, findings) {
  const config = JSON.parse(readText(path.join(root, "knip.json")));
  const entries = Array.isArray(config.entry) ? config.entry : [];
  let resolved = 0;
  for (const entry of entries) {
    if (typeof entry !== "string") { findings.push(finding("invalid-knip-entry", String(entry), "knip.json")); continue; }
    if (entry.includes("*")) {
      const matches = globMatches(root, entry);
      if (matches === 0) findings.push(finding("missing-knip-entry", entry, "knip.json"));
      else resolved += matches;
      continue;
    }
    if (fs.existsSync(path.join(root, entry))) resolved += 1;
    else findings.push(finding("missing-knip-entry", entry, "knip.json"));
  }
  return { entries: entries.length, resolved };
}

/** @param {string} root @param {any[]} findings @param {any[]} notices @param {Set<string>} scriptNames @param {Set<string>} reasonIdSet */
function checkWorkflowFiles(root, findings, notices, scriptNames, reasonIdSet) {
  const dir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(dir)) { notices.push({ kind: "workflows-missing", target: dir, source: ".github" }); return { files: 0, fileTargets: 0 }; }
  let files = 0;
  let fileTargets = 0;
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))) {
    files += 1;
    const relative = path.join(".github", "workflows", name);
    const text = readText(path.join(dir, name));
    for (const token of fileTokens(text)) {
      fileTargets += 1;
      if (!fs.existsSync(resolveToken(root, token))) findings.push(finding("missing-workflow-target", token, relative));
    }
    for (const match of text.matchAll(/pnpm\s+run\s+([A-Za-z0-9:@._/-]+)/gu)) {
      if (!scriptNames.has(match[1])) findings.push(finding("unknown-workflow-script", match[1], relative));
    }
    for (const id of qualificationIds(text)) {
      if (!reasonIdSet.has(id)) findings.push(finding("unknown-qualification-id", id, relative));
    }
  }
  return { files, fileTargets };
}

/** @param {string} root @param {any[]} findings @param {any[]} notices @param {Set<string>} reasonIdSet */
function checkInstallSh(root, findings, notices, reasonIdSet) {
  const text = readText(path.join(root, "install.sh"));
  let fileTargets = 0;
  for (const token of fileTokens(text)) {
    fileTargets += 1;
    if (!fs.existsSync(resolveToken(root, token))) findings.push(finding("missing-install-target", token, "install.sh"));
  }
  // The source frontend is exec'd through a computed $base path, so bind the
  // literal frontend explicitly instead of pretending the token scan covers it.
  const frontend = "scripts/source-install.mjs";
  if (!text.includes(frontend)) findings.push(finding("missing-install-frontend", frontend, "install.sh"));
  if (!fs.existsSync(path.join(root, frontend))) findings.push(finding("missing-install-frontend-file", frontend, "install.sh"));
  for (const id of qualificationIds(text)) {
    if (!reasonIdSet.has(id)) findings.push(finding("unknown-qualification-id", id, "install.sh"));
  }
  notices.push({ kind: "install-frontend", target: frontend, source: "install.sh", fileTargets });
  return { fileTargets };
}

/** @param {string} root @param {any[]} findings */
function checkRequiredEntrypoints(root, findings) {
  let present = 0;
  for (const relative of REQUIRED_ENTRYPOINTS) {
    if (fs.existsSync(path.join(root, relative))) present += 1;
    else findings.push(finding("missing-required-entrypoint", relative, "reference-audit"));
  }
  return { required: REQUIRED_ENTRYPOINTS.length, present };
}

/** @param {string} root @returns {string[]} */
function sourceFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    if (files.length > MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name.endsWith(".ts"))) files.push(absolute);
    }
  };
  for (const relative of ["scripts", "src"]) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute)) walk(absolute);
  }
  return files;
}

/**
 * Collect real module specifiers from the TypeScript AST. Raw-text scanning is
 * not acceptable here: an import-shaped string inside a template literal or
 * comment is not a reference and must not be reported.
 * @param {string} file @param {string} text @returns {string[]}
 */
function collectSpecifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** @type {string[]} */
  const specifiers = [];
  /** @param {any} node */
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const literal = node.moduleSpecifier;
      if (literal && ts.isStringLiteral(literal)) specifiers.push(literal.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (reference && ts.isExternalModuleReference(reference) && reference.expression && ts.isStringLiteral(reference.expression)) specifiers.push(reference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamicImport = Boolean(callee) && callee.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = Boolean(callee) && ts.isIdentifier(callee) && callee.text === "require";
      const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
      if ((dynamicImport || requireCall) && first && ts.isStringLiteral(first)) specifiers.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/**
 * TypeScript resolution first, then a literal-file fallback so that production
 * ".js"-specifier and ".mjs"-to-".mjs" edges are not false positives. A target
 * must fail both checks before it is reported.
 * @param {string} file @param {string} specifier @param {any} compilerOptions
 */
function resolvesSpecifier(file, specifier, compilerOptions) {
  if (ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule) return true;
  const absolute = path.resolve(path.dirname(file), specifier);
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return true;
  } catch {
    return false;
  }
  for (const extension of [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]) {
    if (fs.existsSync(absolute + extension)) return true;
  }
  for (const entry of ["index.ts", "index.js", "index.mjs"]) {
    if (fs.existsSync(path.join(absolute, entry))) return true;
  }
  return false;
}

/** @param {string} root @param {any[]} findings @param {any[]} notices */
function checkImports(root, findings, notices) {
  /** @type {any} */
  let compilerOptions = {};
  try {
    const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    compilerOptions = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root).options;
  } catch (error) {
    notices.push({ kind: "tsconfig-unavailable", target: String(error), source: "tsconfig.json" });
  }
  const files = sourceFiles(root);
  let literalSpecifiers = 0;
  let externalSpecifiers = 0;
  for (const file of files) {
    const text = readText(file);
    const relative = path.relative(root, file);
    /** @type {string[]} */
    const specifiers = collectSpecifiers(file, text);
    for (const specifier of specifiers) {
      literalSpecifiers += 1;
      if (specifier.startsWith("node:") || specifier.startsWith("data:")) { externalSpecifiers += 1; continue; }
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) { externalSpecifiers += 1; continue; }
      if (!resolvesSpecifier(file, specifier, compilerOptions)) findings.push(finding("unresolved-import", specifier, relative));
    }
  }
  notices.push({ kind: "import-scan", target: files.length + " files", source: "scripts+src" });
  return { files: files.length, literalSpecifiers, externalSpecifiers };
}

/** @param {string} root @param {string} relative @param {string} text */
function writeFixtureFile(root, relative, text) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, text, { mode: 0o600 });
}

/** @param {string} root @param {Record<string, string>} files */
function writeFixture(root, files) {
  for (const [relative, text] of Object.entries(files)) writeFixtureFile(root, relative, text);
  return root;
}

/** Read-only structural audit. Never imports or evaluates a scanned script. */
/** @param {string} root */
function auditReferences(root) {
  /** @type {any[]} */
  const findings = [];
  /** @type {any[]} */
  const notices = [];
  const qualificationFile = path.join(root, QUALIFICATION_SCRIPT);
  const reasonIdSet = fs.existsSync(qualificationFile) ? reasonIds(readText(qualificationFile)) : new Set();
  if (reasonIdSet.size === 0) findings.push(finding("missing-qualification-index", QUALIFICATION_SCRIPT, "reference-audit"));
  const packageText = readText(path.join(root, "package.json"));
  for (const id of qualificationIds(packageText)) {
    if (!reasonIdSet.has(id)) findings.push(finding("unknown-qualification-id", id, "package.json"));
  }
  const packageResult = checkPackageScripts(root, findings, notices);
  const entrypoints = checkRequiredEntrypoints(root, findings);
  const knip = checkKnipEntries(root, findings);
  const install = checkInstallSh(root, findings, notices, reasonIdSet);
  const workflows = checkWorkflowFiles(root, findings, notices, packageResult.names, reasonIdSet);
  const imports = checkImports(root, findings, notices);
  return {
    schemaVersion: 1,
    qualification: false,
    localDevelopmentOnly: true,
    mode: "reference-audit",
    root,
    reasonIds: [...reasonIdSet].sort(),
    counts: {
      scripts: packageResult.count,
      scriptFileTargets: packageResult.fileTargets,
      scriptReferences: packageResult.scriptRefs,
      requiredEntrypoints: entrypoints.required,
      requiredEntrypointsPresent: entrypoints.present,
      knipEntries: knip.entries,
      knipResolved: knip.resolved,
      workflowFiles: workflows.files,
      workflowFileTargets: workflows.fileTargets,
      installFileTargets: install.fileTargets,
      sourceFiles: imports.files,
      literalSpecifiers: imports.literalSpecifiers,
      externalSpecifiers: imports.externalSpecifiers,
    },
    findingKinds: [...new Set(findings.map((entry) => entry.kind))].sort(),
    findings,
    notices,
    ok: findings.length === 0,
  };
}

const CONTROL_QUALIFICATION = "const reasons = {\n  \"known-id\": \"fixture reason\",\n};\n";
const CONTROL_TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2024", module: "NodeNext", moduleResolution: "NodeNext", allowJs: true, strict: false } }, null, 2) + "\n";
const CONTROL_INSTALL = "#!/bin/bash\nexec node \"$base/scripts/source-install.mjs\" --source\n";

/** @param {string} dir */
function cleanFixture(dir) {
  return writeFixture(dir, {
    "package.json": JSON.stringify({ name: "reference-control", version: "0.0.0", scripts: { ok: "node scripts/present.mjs", qual: "node scripts/qualification-unavailable.mjs known-id" } }, null, 2) + "\n",
    "tsconfig.json": CONTROL_TSCONFIG,
    "knip.json": JSON.stringify({ entry: ["scripts/present.mjs"] }, null, 2) + "\n",
    "install.sh": CONTROL_INSTALL,
    "scripts/present.mjs": "import \"./also-present.mjs\";\nexport const present = 1;\n",
    "scripts/also-present.mjs": "export const also = 1;\n",
    "scripts/source-install.mjs": "export const source = 1;\n",
    "scripts/build.mjs": "export const build = 1;\n",
    "scripts/build-kiro-closure.mjs": "export const closure = 1;\n",
    "scripts/qualification-unavailable.mjs": CONTROL_QUALIFICATION,
    ".github/workflows/ci.yml": "jobs:\n  audit:\n    steps:\n      - run: node scripts/present.mjs\n      - run: pnpm run ok\n",
  });
}

/** @param {string} dir */
function brokenFixture(dir) {
  return writeFixture(dir, {
    "package.json": JSON.stringify({ name: "reference-control-broken", version: "0.0.0", scripts: { ok: "node scripts/present.mjs", broken: "node scripts/absent.mjs", qual: "node scripts/qualification-unavailable.mjs unknown-id", indirect: "pnpm run missing-script" } }, null, 2) + "\n",
    "tsconfig.json": CONTROL_TSCONFIG,
    "knip.json": JSON.stringify({ entry: ["scripts/absent.mjs"] }, null, 2) + "\n",
    "install.sh": "#!/bin/bash\nexec node \"$base/frontend.mjs\"\n",
    "scripts/present.mjs": "import \"./absent.mjs\";\nexport const present = 1;\n",
    "scripts/source-install.mjs": "export const source = 1;\n",
    "scripts/build.mjs": "export const build = 1;\n",
    "scripts/qualification-unavailable.mjs": CONTROL_QUALIFICATION,
    ".github/workflows/ci.yml": "jobs:\n  audit:\n    steps:\n      - run: node scripts/also-absent.mjs\n      - run: pnpm run missing-script\n",
  });
}

// Prove the audit is not vacuous: a clean synthetic root must stay clean and a
// deliberately broken one must produce each expected finding kind.
function runSelfTest() {
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reference-audit-clean-"));
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reference-audit-broken-"));
  const clean = auditReferences(cleanFixture(cleanRoot));
  const broken = auditReferences(brokenFixture(brokenRoot));
  const kinds = new Set(broken.findingKinds);
  const controls = {
    cleanRootStayedClean: clean.findings.length === 0,
    cleanFindingKinds: clean.findingKinds,
    detectedMissingTarget: kinds.has("missing-script-target"),
    detectedUnknownScript: kinds.has("unknown-script") || kinds.has("unknown-workflow-script"),
    detectedUnknownIndirectScript: kinds.has("unknown-script"),
    detectedMissingKnipEntry: kinds.has("missing-knip-entry"),
    detectedMissingWorkflowTarget: kinds.has("missing-workflow-target"),
    detectedUnknownQualificationId: kinds.has("unknown-qualification-id"),
    detectedUnresolvedImport: kinds.has("unresolved-import"),
    detectedMissingInstallFrontend: kinds.has("missing-install-frontend"),
    detectedMissingRequiredEntrypoint: kinds.has("missing-required-entrypoint"),
    brokenFindingKinds: broken.findingKinds,
    cleanRoot,
    brokenRoot,
  };
  controls.ok = controls.cleanRootStayedClean &&
    controls.detectedMissingTarget && controls.detectedUnknownScript &&
    controls.detectedMissingKnipEntry && controls.detectedMissingWorkflowTarget &&
    controls.detectedUnknownQualificationId && controls.detectedUnresolvedImport &&
    controls.detectedMissingInstallFrontend && controls.detectedMissingRequiredEntrypoint;
  return controls;
}

const USAGE = [
  "usage: node scripts/verify-project-references.mjs [--json] [--help]",
  "",
  "Read-only audit of package scripts, workflow commands, install.sh, knip",
  "entries, required entrypoints and literal module imports.",
  "",
  "Local-development verification only. Not release qualification.",
].join("\n");

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { process.stdout.write(USAGE + "\n"); return 0; }
  if (args.includes("--self-test=missing-target")) {
    const controls = runSelfTest();
    process.stdout.write(JSON.stringify({ schemaVersion: 1, qualification: false, localDevelopmentOnly: true, mode: "self-test", controls, ok: controls.ok }, null, 2) + "\n");
    return controls.ok === true ? 0 : 1;
  }
  const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write("verify-project-references: unknown flag: " + unknown.join(", ") + "\n" + USAGE + "\n");
    return 2;
  }
  const report = auditReferences(ROOT);
  if (!args.includes("--json")) report.notices = [];
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.stderr.write("verify-project-references: " + report.findings.length + " reference finding(s)\n");
  return report.ok ? 0 : 1;
}

process.exitCode = await main();
