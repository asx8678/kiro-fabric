#!/usr/bin/env node
// Kiro Fabric — educational TUI front-end for the installer.
//
// PRESENTATION ONLY. Every mutation is delegated to `install.sh --source`,
// whose transactional manager owns the safety-critical behavior: umask 077,
// unprivileged assertion, trusted-executable checks, the generation journal,
// candidate smoke validation, rollback and offline recovery. This script
// never writes into the Kiro home itself; its only output file is the
// private installation log shown to the user on completion and failure.
//
// Zero dependencies: plain Node (>=24) with manual ANSI, honoring NO_COLOR
// and non-TTY terminals by falling back to plain text.
//
// CUSTOMIZATION GUIDE
//   - Product explanations: edit FABRIC_INTRO / FOVEA_INTRO below.
//   - What the installer touches: edit the MODIFICATIONS array.
//   - Preflight thresholds: DISK_MIN_BYTES, PINNED_NODE, and the pnpm pin
//     (read from package.json "packageManager" — single source of truth).
//   - Visual identity: BANNER, WIDTH, and the ANSI palette in `paint`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findKiro } from "./install-manager.mjs";

const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const INSTALL_SH = path.join(ROOT, "install.sh");

// ── Visual identity ────────────────────────────────────────────────────────

// ANSI-Shadow "FABRIC" — fixed-width glyph cells (F/A/B/R 8 cols, I 3, C 8)
// joined with single spaces; trailing padding stripped so no line carries
// trailing whitespace. Each letter matches the canonical ANSI Shadow form.
const BANNER = `
  ███████╗  █████╗  ██████╗  ██████╗  ██╗  █████╗
  ██╔════╝ ██╔══██╗ ██╔══██╗ ██╔══██╗ ██║ ██╔══██╗
  █████╗  ███████║ ██████╔╝ ██████╔╝ ██║ ██║
  ██╔══╝  ██╔══██║ ██╔══██╗ ██╔══██╗ ██║ ██║
  ██║      ██║  ██║ ██████╔╝ ██║  ██║ ██║ ╚██████╗
  ╚═╝      ╚═╝  ╚═╝ ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═════╝
`;

const WIDTH = 68;
const DISK_MIN_BYTES = 2 * 1024 * 1024 * 1024; // advisory free-space floor
const PINNED_NODE = "24.0.0"; // mirror of the authoritative check in source-install.mjs

// The pnpm pin is read from package.json so this front-end can never drift
// from the authoritative prerequisite in scripts/source-install.mjs.
const PINNED_PNPM = /^pnpm@(\S+)$/u.exec(String(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).packageManager ?? ""))?.[1] ?? null;

/** Educational copy. Keep these grounded in the shipped product: Fabric is
 * the agent/orchestration side; Fovea is the bundled repository navigation
 * engine. Update this text when the product surfaces change. */
const FABRIC_INTRO = [
  "Fabric is the agent orchestration layer that runs INSIDE Kiro CLI v3 as an",
  "MCP server (@fabric/fabric_exec). It gives the agent a trusted tool fabric:",
  "local file/bash/search tools with approval gates and per-effect accounting, a",
  "private workspace-bound state store, memory, review tooling, and durable",
  "continuity checkpoints for explicit session handoff. It ships a private",
  "Node.js runtime and ripgrep so the agent never depends on your system tools.",
];
const FOVEA_INTRO = [
  "Fovea is the repository navigation engine bundled with the agent profile. It",
  "snapshots your source tree, indexes it through ast-grep into a typed code",
  "graph, and serves sketch / focus / dwell / impact operations so the agent",
  "can reason about structure instead of re-reading whole files. It activates",
  "per-session on explicit request, keeps a bounded private snapshot cache,",
  "and never modifies your working tree or Kiro settings on its own.",
];

/** Everything the underlying installer may create or change. Mirrors the
 * manager's plans (home preparation, launch profile, shell integration). */
const MODIFICATIONS = [
  ["KIRO_HOME/kiro-fabric/bin", "launcher shim (kiro-fabric start/doctor/...)"],
  ["KIRO_HOME/kiro-fabric/manager", "transactional install/update/rollback manager"],
  ["KIRO_HOME/kiro-fabric/runtime/<gen>/tools", "private Node.js + ripgrep generations"],
  ["KIRO_HOME/kiro-fabric/agent", "agent profile bound to kiro-cli --v3"],
  ["KIRO_HOME/kiro-fabric/{skills,steering}", "agent skills and steering documents"],
  ["KIRO_HOME/kiro-fabric/backups", "Kiro configuration backups (created on change)"],
  ["KIRO_HOME/kiro-fabric/logs/installer.log", "bounded private operation log (successes)"],
  ["KIRO_HOME/kiro-fabric/install-owner.json", "installation ownership manifest"],
  ["Optional shell integration file", "workspace handoff helper; prior content is backed up first"],
];
const NOT_TOUCHED = [
  "No system packages, no sudo, no PATH changes, no kiro-cli install or upgrade",
  "(Kiro CLI >= 2.21.1 must already be installed), and no authentication is",
  "performed. Durable data is retained across updates; uninstall retires the",
  "managed profile but never deletes data or repositories.",
];

// ── Terminal plumbing ────────────────────────────────────────────────────────

const TUI = {
  parse: raw => {
    const flags = { verbose: false, dryRun: false, yes: false, noColor: false, help: false, kiroHome: undefined, noShellIntegration: false };
    for (let index = 0; index < raw.length; index++) {
      const argument = raw[index];
      if (argument === "--verbose" || argument === "-v") flags.verbose = true;
      else if (argument === "--dry-run") flags.dryRun = true;
      else if (argument === "--yes" || argument === "-y") flags.yes = true;
      else if (argument === "--no-color") flags.noColor = true;
      else if (argument === "--help" || argument === "-h") flags.help = true;
      else if (argument === "--no-shell-integration") flags.noShellIntegration = true;
      else if (argument === "--kiro-home") { const value = raw[++index]; if (!value || value.startsWith("--")) usageError("--kiro-home requires an absolute path"); flags.kiroHome = value; }
      else usageError(`unknown option: ${argument}`);
    }
    if (flags.kiroHome !== undefined && !path.isAbsolute(flags.kiroHome)) usageError("--kiro-home must be absolute");
    return flags;
  },
};
function usageError(message) { process.stderr.write(`install-tui: ${message}\nRun: node scripts/install-tui.mjs --help\n`); process.exit(2); }
function helpText() {
  return ["usage: node scripts/install-tui.mjs [options]", "",
    "  Educational TUI front-end. Prompts, explains, then delegates to install.sh --source.", "",
    "  -v, --verbose             stream raw installer/build output live",
    "      --dry-run             read-only preview through the real installer (no consent needed)", "  -y, --yes                 accept the TUI confirmation non-interactively",
    "      --kiro-home PATH      absolute Kiro home (default: ~/.kiro)",
    "      --no-shell-integration  skip the optional shell setup",
    "      --no-color            force plain text (default when not a TTY or NO_COLOR)",
    "  -h, --help                this help", "",
    "The underlying installer keeps its own gates: transactional generations,",
    "rollback (kiro-fabric rollback), offline recovery (kiro-fabric recover),",
    "and exit codes 0/2/3/4/5/6/7/8 (see install.sh --source --help)."].join("\n") + "\n";
}

let paint;
function buildPaint(enabled) {
  const identity = value => value;
  if (!enabled) return { dim: identity, bold: identity, cyan: identity, green: identity, yellow: identity, red: identity, reset: identity };
  const wrap = code => value => `\u001b[${code}m${value}\u001b[0m`;
  return { dim: wrap("2"), bold: wrap("1"), cyan: wrap("36"), green: wrap("32"), yellow: wrap("33"), red: wrap("31"), reset: () => "\u001b[0m" };
}

const fit = text => {
  // Pad/truncate to the panel width so frames stay rectangular.
  const width = [...text].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  return width > WIDTH - 4 ? `${text.slice(0, WIDTH - 7)}…` : text + " ".repeat(Math.max(0, WIDTH - 4 - width));
};
function frame(title, lines) {
  const head = `┌─ ${title} ${"─".repeat(Math.max(0, WIDTH - title.length - 5))}┐`;
  const body = lines.map(line => `│ ${fit(line)} │`);
  return [head, ...body, `└${"─".repeat(WIDTH - 1)}┘`].join("\n");
}

/** Single-line spinner. Only used on a TTY without --verbose; pauses for
 * every installer chunk so raw output is never interleaved mid-line. */
class Spinner {
  #frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  #timer; #index = 0; #active = false;
  start(label) {
    if (!this.#enabled() || this.#active) return;
    this.#active = true;
    this.#timer = setInterval(() => { process.stderr.write(`\r${paint.cyan(this.#frames[this.#index++ % this.#frames.length])} ${label} `); }, 90);
    this.#timer.unref?.();
  }
  pause() { if (!this.#active) return; clearInterval(this.#timer); this.#active = false; process.stderr.write("\r\u001b[2K"); }
  #enabled() { return process.stderr.isTTY && !flags.verbose; }
}

const flags = TUI.parse(process.argv.slice(2));
if (flags.help) { process.stdout.write(helpText()); process.exit(0); }
process.umask(0o077); // mirror the installer's private-by-default hygiene for our log file
paint = buildPaint(process.stderr.isTTY && process.stdout.isTTY && !process.env.NO_COLOR && !flags.noColor);
const spinner = new Spinner();

/** A new private directory per invocation prevents shared-temp collisions.
 * Never reopen the predictable legacy log or repair an untrusted entry. Keep
 * failed setup evidence, but do not write until type, ownership, permissions
 * and the descriptor/path identities have all been verified. */
function createPrivateLog() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fabric-fovea-install-"));
  const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
  const privateMode = (stat, mode) => process.platform === "win32" ||
    (stat.uid === process.getuid?.() && (stat.mode & 0o7777) === mode);
  const initial = fs.lstatSync(directory);
  if (!initial.isDirectory() || initial.isSymbolicLink() || !privateMode(initial, 0o700)) throw new Error("Unsafe TUI log directory");
  const file = path.join(directory, "installer.log");
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const opened = fs.fstatSync(fd), named = fs.lstatSync(file), current = fs.lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || !same(initial, current) || !privateMode(current, 0o700) ||
        !opened.isFile() || !named.isFile() || named.isSymbolicLink() || !same(opened, named) ||
        opened.nlink !== 1 || named.nlink !== 1 || !privateMode(opened, 0o600) || !privateMode(named, 0o600)) {
      throw new Error("Unsafe TUI log file or directory identity");
    }
  } catch (error) { fs.closeSync(fd); throw error; }
  let closed = false;
  return {
    path: file,
    write(chunk) { fs.writeSync(fd, chunk); },
    close() { if (closed) return; closed = true; try { fs.closeSync(fd); } catch {} },
  };
}
const log = createPrivateLog();
const LOG_PATH = log.path;
const say = text => { process.stderr.write(`${text}\n`); log.write(`${text}\n`); };
// Print the full path before preflight/consent can exit, without panel clipping.
say(paint.dim(`Installation log: ${LOG_PATH}`));

// ── Preflight (advisory display; enforcement stays in the installer) ───────

function stepCounter(total) { let index = 0; return label => `${paint.dim(`[${++index}/${total}]`)} ${label}`; }
const check = (symbol, label, detail = "") => say(`${symbol} ${label}${detail ? paint.dim(`  ${detail}`) : ""}`);

async function preflight() {
  const next = stepCounter(7);
  say(paint.bold(paint.cyan("Pre-installation checks")));

  check(paint.cyan("i"), next("System"), `${process.platform}-${process.arch}, umask ${process.umask().toString(8).padStart(3, "0")}`);

  if (process.getuid?.() === 0) {
    check(paint.red("✗"), next("Privileges"), "refusing to run as root; the installer requires an unprivileged user");
    return false;
  }
  check(paint.green("✓"), next("Privileges"), "running unprivileged");

  const [major] = process.versions.node.split(".");
  if (Number(major) < Number(PINNED_NODE.split(".")[0])) { check(paint.red("✗"), next("Node.js"), `found ${process.versions.node}, need >= ${PINNED_NODE}`); return false; }
  check(paint.green("✓"), next("Node.js"), process.versions.node);

  try {
    const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 10_000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
    const found = pnpm.status === 0 ? (pnpm.stdout ?? "").trim() : "";
    if (pnpm.error || pnpm.status !== 0 || (PINNED_PNPM && found !== PINNED_PNPM)) check(paint.yellow("!"), next("pnpm"), `found ${found || "none"}; installer requires pinned pnpm ${PINNED_PNPM ?? "11.20.0"}`);
    else check(paint.green("✓"), next("pnpm"), `${found} (pinned)`);
  } catch { check(paint.yellow("!"), next("pnpm"), "not found; the installer will fail its own prerequisite if a build is needed"); }

  try {
    const target = path.dirname(fs.realpathSync(process.env.KIRO_HOME ?? path.join(os.homedir(), ".kiro")));
    const stats = fs.statfsSync(target);
    const free = stats.bsize * stats.bavail;
    check(free >= DISK_MIN_BYTES ? paint.green("✓") : paint.yellow("!"), next("Disk space"), `${(free / 1024 ** 3).toFixed(1)} GiB free on ${target}`);
  } catch { check(paint.yellow("!"), next("Disk space"), "unavailable"); }

  try { check(paint.green("✓"), next("Kiro CLI"), `${findKiro()} (validated safe)`); }
  catch (error) { check(paint.yellow("!"), next("Kiro CLI"), `${error.message} — required by install; install the official Kiro client first`); }

  if (!fs.existsSync(INSTALL_SH)) { check(paint.red("✗"), next("Checkout"), "install.sh missing from the checkout"); return false; }
  check(paint.green("✓"), next("Checkout"), path.basename(ROOT));
  return true;
}

// ── Education and consent ────────────────────────────────────────────────────

function overview() {
  process.stderr.write(paint.cyan(BANNER) + "\n");
  say(paint.dim("This front-end explains, confirms, and logs. The audited installer does the work.\n"));
  process.stderr.write(frame("WHAT IS FABRIC?", FABRIC_INTRO) + "\n\n");
  log.write(frame("WHAT IS FABRIC?", FABRIC_INTRO) + "\n");
  process.stderr.write(frame("WHAT IS FOVEA?", FOVEA_INTRO) + "\n\n");
  log.write(frame("WHAT IS FOVEA?", FOVEA_INTRO) + "\n");
  const modifications = MODIFICATIONS.map(([item, detail]) => `  ${paint.cyan("•")} ${item.padEnd(42)} ${paint.dim(detail)}`);
  process.stderr.write(frame("SYSTEM MODIFICATIONS", modifications) + "\n\n");
  log.write(frame("SYSTEM MODIFICATIONS", MODIFICATIONS.map(([item, detail]) => `  • ${item}  (${detail})`)) + "\n");
  process.stderr.write(frame("NOT TOUCHED", NOT_TOUCHED) + "\n\n");
  log.write(frame("NOT TOUCHED", NOT_TOUCHED) + "\n");
  if (flags.dryRun) say(paint.yellow("[!] Read-only preview: nothing below will be modified (--dry-run)."));
}

async function confirm() {
  if (flags.dryRun) return true;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    if (!flags.yes) { say(paint.red("✗ Non-interactive terminal: pass --yes after reading the breakdown, or use install.sh directly.")); process.exit(2); }
    say(paint.dim("--yes accepted non-interactively."));
    return true;
  }
  if (flags.yes) return true;
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await terminal.question(paint.bold("Proceed with installation? [Y/n] "))).trim().toLowerCase();
    if (["", "y", "yes"].includes(answer)) return true;
    say(paint.yellow("Cancelled before any modification."));
    process.exit(3); // mirrors the installer's cancelled exit code
  } finally { terminal.close(); }
}

// ── Delegation, tee'd logging and signal traps ───────────────────────────────

async function runInstaller() {
  const args = [INSTALL_SH, "--source", ...(flags.dryRun ? ["--dry-run"] : ["--yes"]), ...(flags.kiroHome ? ["--kiro-home", flags.kiroHome] : []), ...(flags.noShellIntegration ? ["--no-shell-integration"] : []), ...(flags.verbose ? ["--verbose"] : [])];
  say(paint.dim(`Delegating to: bash ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`));
  say(paint.dim(`Verbose raw output: ${flags.verbose ? "on" : "off (add -v)"} · Log: ${LOG_PATH}\n`));

  const child = spawn("bash", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  // Tee both streams to the terminal and the log; the spinner only wakes
  // after a quiet period so frequent chunks never make it flicker.
  let quiet = undefined;
  const forward = out => chunk => { spinner.pause(); clearTimeout(quiet); out.write(chunk); log.write(chunk); quiet = setTimeout(() => spinner.start("installer working"), 1200); quiet.unref?.(); };
  child.stdout.on("data", forward(process.stdout));
  child.stderr.on("data", forward(process.stderr));

  // Trap: forward interrupts to the installer, preserve the log, exit with the
  // conventional signal status so callers can distinguish cancellation.
  const signals = { SIGINT: 2, SIGTERM: 15 };
  let interrupted = 0;
  for (const [signal, number] of Object.entries(signals)) process.on(signal, () => { interrupted = number; child.kill(/** @type {NodeJS.Signals} */ (signal)); });

  const raw = await new Promise(resolve => {
    child.once("error", error => { say(paint.red(`✗ Failed to start the installer: ${error.message}`)); resolve(1); });
    child.once("exit", resolve);
  });
  spinner.pause();
  clearTimeout(quiet);
  // A signal kill reports exit=null; never let that masquerade as success.
  if (interrupted) { finish(`Interrupted (SIG${interrupted === 2 ? "INT" : "TERM"}). Partial state is journaled; the installer's recover path preserves evidence.`, 128 + interrupted); }
  return typeof raw === "number" ? raw : 1;
}

function finish(message, code) {
  say("");
  const symbol = code === 0 ? paint.green("✓") : paint.red("✗");
  process.stderr.write(frame(code === 0 ? "DONE" : "STOPPED", [
    `${symbol} ${message}`,
    `Log: ${LOG_PATH}`,
    paint.dim(code === 0 ? "Next: launch from a project directory (see the installer output above)." : "Next: inspect the log; kiro-fabric doctor and kiro-fabric recover are safe follow-ups."),
  ]) + "\n");
  log.write(`\n[${new Date().toISOString()}] finished: exit ${code}\n`);
  log.close();
  process.exit(code);
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY && !flags.yes && !flags.dryRun && !flags.help) {
  process.stderr.write("install-tui: interactive mode needs a terminal. Re-run in a TTY, or pass --yes, or use: bash install.sh --source --yes\n");
  process.exit(2);
}
if (!(await preflight())) { log.close(); process.exit(4); }
overview();
await confirm();
const code = await runInstaller();
finish(code === 0 ? (flags.dryRun ? "Read-only preview completed; nothing was modified." : "Installation flow completed with exit code 0. " + "Review the installer output above for next steps.") : `Installer exited with code ${code}. Evidence is preserved; nothing was retried.`, code);
