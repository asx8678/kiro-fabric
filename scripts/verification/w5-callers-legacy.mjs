// W5 caller regression support: load the authentic reconstructed pre-W5 installer
// from an immutable maintained text fixture, or the byte-current maintained entry.
// The pre-W5 bytes are pinned by sha256 and must match the Astra W5 before-state
// capture recorded before W5 patching. No session-local .tmp artifact is read.
//
// Fixture bytes are NEVER edited. Two documented harness-only seams apply at load:
//   1. relative sibling imports are rewritten to absolute repo script URLs so the
//      historical source can import the current standalone helpers; and
//   2. one exact executable-trust line is replaced with an inert boundary so
//      locking/admission regressions run under a harness Node (e.g. Homebrew)
//      whose ancestry is not trusted. Lock/ownership behaviour is unchanged.
// See scripts/verification/fixtures/w5/README.md.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const HISTORICAL_ENTRY = "scripts/install-agent-user.mjs";
const PRE_W5_FIXTURE = path.join("scripts", "verification", "fixtures", "w5", "install-agent-user.pre-w5.mjs.txt");
const PRE_W5_SHA256 = "43c1932d604a66117d26cba1fbfd5e11eed0b7891e58a300b04df720730fdc6b";

const TRUST_LINE = "const nodePath = assertTrustedExecutable(fs.realpathSync(process.execPath));";
const INERT_TRUST = "const nodePath = fs.realpathSync(process.execPath); // probe only: executable trust boundary inert; no executable is launched";

/** Locate and hash-verify the pinned pre-W5 fixture. Never reads session .tmp.
 * @param {string} repoRoot */
function locateHistoricalEntry(repoRoot) {
  const artifact = path.join(repoRoot, PRE_W5_FIXTURE);
  if (!fs.existsSync(artifact)) return { available: false, reason: "pinned pre-W5 fixture not present" };
  const bytes = fs.readFileSync(artifact);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PRE_W5_SHA256) return { available: false, reason: `pinned pre-W5 fixture hash mismatch (${digest} != ${PRE_W5_SHA256})` };
  return { available: true, artifact, bytes, digest, recorded: PRE_W5_SHA256 };
}

const rewire = (text, repoRoot) => text.replace(/from "(\.\/[^"]+)"/gu, (_match, rel) => "from " + JSON.stringify(pathToFileURL(path.resolve(repoRoot, "scripts", rel)).href));

/** @param {string} repoRoot @param {Buffer} bytes @param {string} cacheFile @param {string[]} exportNames @param {(text:string)=>string} [transform] */
async function loadRewired(repoRoot, bytes, cacheFile, exportNames, transform) {
  let text = bytes.toString("utf8");
  if (transform) text = transform(text);
  text = rewire(text, repoRoot);
  if (exportNames.length > 0) text += "\nexport { " + exportNames.join(", ") + " };\n";
  fs.writeFileSync(cacheFile, text, { mode: 0o600, flag: "wx" });
  return import(pathToFileURL(cacheFile).href);
}

/** Load the byte-current maintained installer, preserving its existing exports.
 * inertTrust replaces exactly the executable-trust line with an inert boundary so
 * locking/admission regressions can run under a harness Node whose ancestry is not
 * trusted (e.g. Homebrew). It never changes lock or ownership behaviour. */
export async function loadMaintainedInstaller(repoRoot, cacheDir, { inertTrust = false } = {}) {
  const bytes = fs.readFileSync(path.join(repoRoot, HISTORICAL_ENTRY));
  const text = bytes.toString("utf8");
  let transform;
  if (inertTrust) {
    if (!text.includes(TRUST_LINE)) return { module: undefined, unavailable: "maintained executable-trust line absent; refusing to fabricate the installer" };
    transform = (value) => value.replace(TRUST_LINE, INERT_TRUST);
  }
  const module = await loadRewired(repoRoot, bytes, path.join(cacheDir, "w5-callers-maintained-entry.mjs"), [], transform);
  return { module, digest: createHash("sha256").update(bytes).digest("hex"), trustBoundary: inertTrust ? "inert" : "enforced" };
}

/** Load the authentic pre-W5 installer, or report why it is unavailable. */
export async function loadHistoricalInstaller(repoRoot, cacheDir) {
  const located = locateHistoricalEntry(repoRoot);
  if (!located.available) return located;
  if (!located.bytes.toString("utf8").includes(TRUST_LINE)) {
    return { available: false, reason: "historical executable-trust line absent; refusing to fabricate the historical installer" };
  }
  const module = await loadRewired(repoRoot, located.bytes, path.join(cacheDir, "w5-callers-historic-entry.mjs"), ["installUserAgent", "uninstallUserAgent"],
    text => text.replace(TRUST_LINE, INERT_TRUST));
  return { available: true, module, digest: located.digest, recorded: located.recorded };
}
