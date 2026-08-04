#!/usr/bin/env node
/**
 * Fabric Lite — Advanced Interactive Installer
 *
 * A box-drawn, keyboard-navigable setup tool that detects the current state
 * and offers Install / Update / Repair / Delete. Install and Update always
 * configure writable access (workspace + mutations enabled) so you can modify
 * files and work — read-only is opt-in via --allow-write read.
 *
 *   Controls:  ↑/↓ move · Enter select · Esc/q cancel
 *   Non-interactive: pipe numbers, e.g. `echo 2 | node scripts/install.mjs`
 *
 * Flags: --cwd <dir>  --allow-write read|workspace  --yes (skip install/update confirm)
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// ── ANSI ────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
  magenta: (s) => `\x1b[35m${s}\x1b[39m`,
  blue: (s) => `\x1b[34m${s}\x1b[39m`,
  gray: (s) => `\x1b[90m${s}\x1b[39m`,
  bg: (s) => `\x1b[44m\x1b[97m${s}\x1b[39m\x1b[49m`,
};
const B = {
  ok: C.green("✔"),
  warn: C.yellow("⚠"),
  err: C.red("✘"),
  info: C.cyan("ℹ"),
  arrow: C.cyan("▶"),
  dot: C.gray("·"),
  sel: C.bg(" ▸ "),
  up: C.cyan("⬆"),
  repair: C.magenta("🔧"),
  del: C.red("🗑"),
  q: C.gray("✕"),
};
const W = 58;
const visible = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - visible(String(s)).length));

// ── CLI flags ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const root = path.resolve(flag("--cwd") || process.cwd());
const ASK_WRITE = flag("--allow-write");
const ASSUME_YES = argv.includes("--yes");
const VERSION =
  JSON.parse(readFileSync(path.resolve(root, "package.json"), "utf8")).version || "unknown";

// ── Child helpers ───────────────────────────────────────────────────────
function has(cmd) {
  const res =
    process.platform === "win32"
      ? spawnSync("where", [cmd], { stdio: "ignore" })
      : spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", cmd]);
  return res.status === 0;
}
function runCapture(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  return {
    exitCode: res.status,
    stdout: (res.stdout || "").toString().trim(),
    stderr: (res.stderr || "").toString().trim(),
  };
}

// ── Terminal / input ────────────────────────────────────────────────────
const isTTY = !!process.stdin.isTTY;
let pipedLines = null;
if (!isTTY) {
  try {
    pipedLines = readFileSync(0, "utf8").split(/\r?\n/);
  } catch {
    // stdin is closed or unavailable (e.g. daemon spawn); fall back to interactive-free mode.
    pipedLines = null;
  }
}
function writeOut(s) {
  process.stdout.write(s);
}
function print(s = "") {
  const str = String(s == null ? "" : s);
  console.log(str.split("\n").join("\n"));
}

function askLine(query) {
  if (pipedLines !== null) {
    process.stdout.write(query);
    const next = pipedLines.shift();
    const ans = next === undefined ? "q" : next.trim();
    process.stdout.write(ans + "\n");
    return Promise.resolve(ans);
  }
  return new Promise((resolve) => {
    process.stdin.resume();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (a) => {
      if (!done) {
        done = true;
        rl.close();
        resolve(a.trim());
      }
    };
    rl.on("error", () => finish("q"));
    rl.on("close", () => finish("q"));
    rl.question(query, finish);
  });
}

async function readKey() {
  return new Promise((resolve) => {
    const handler = (chunk) => {
      process.stdin.pause();
      process.stdin.removeListener("data", handler);
      resolve(chunk.toString());
    };
    process.stdin.resume();
    process.stdin.on("data", handler);
  });
}

// ── Box drawing ─────────────────────────────────────────────────────────
function box(title, lines = [], { width = W, titleColor = C.bold } = {}) {
  const inner = width - 2;
  const out = ["┌" + "─".repeat(inner) + "┐"];
  if (title) {
    const t = titleColor(title);
    out.push("│ " + pad(t, inner - 1) + "│");
    out.push("├" + "─".repeat(inner) + "┤");
  }
  for (const l of lines) out.push("│ " + pad(l, inner - 1) + "│");
  out.push("└" + "─".repeat(inner) + "┘");
  return out.join("\n");
}

function boxRow(left, right, width = W) {
  const inner = width - 4;
  const l = visible(left).length,
    r = visible(right).length;
  if (l + r + 2 <= inner) return `${left}${C.gray("·".repeat(inner - l - r - 2))}${right}`;
  return left;
}

// ── Spinner ─────────────────────────────────────────────────────────────
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
async function spinner(label, { okText } = {}) {
  if (!isTTY) {
    print(`  ${C.dim(label)}...`);
    return { stop: () => {} };
  }
  let i = 0;
  writeOut("\x1b[?25l");
  const id = setInterval(() => {
    writeOut(`\r  ${C.cyan(FRAMES[i++ % FRAMES.length])} ${label}`);
  }, 80);
  return {
    stop: (ok = true) => {
      clearInterval(id);
      writeOut(`\r  ${ok ? B.ok : B.err} ${ok && okText ? okText : label}\n`);
      writeOut("\x1b[?25h");
    },
  };
}

// ── Steps runner ────────────────────────────────────────────────────────
async function runSteps(steps) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prefix = `Step ${i + 1}/${steps.length}`;
    const s = await spinner(`${C.bold(prefix)}  ${step.label}`);
    try {
      const ok = await step.run();
      s.stop(ok !== false);
      if (ok === false) throw new Error(step.fail || `${step.label} failed`);
    } catch (e) {
      s.stop(false);
      throw e;
    }
  }
}

// ── Remote / update detection ───────────────────────────────────────────
let cachedRemote = null;
function gitRemote() {
  if (cachedRemote) return cachedRemote;
  cachedRemote = runCapture("git", ["-C", root, "remote", "get-url", "origin"], { timeout: 5000 });
  return cachedRemote;
}

/** Best-effort: query the tracked default branch SHA from origin without checkout. */
async function checkRemoteUpdate(st) {
  st.update = null; // { behind, ahead, localSha, remoteSha }
  if (!st.repo) return st;
  const remote = gitRemote();
  if (remote.exitCode !== 0) return st;
  // Fetch latest refs quietly (no output). Best-effort; failure is not fatal.
  const fetch = runCapture("git", ["-C", root, "fetch", "origin", "--quiet"], { timeout: 20000 });
  if (fetch.exitCode !== 0) return st;
  const branch =
    runCapture("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { timeout: 5000 }).stdout ||
    "main";
  const tracking = runCapture(
    "git",
    ["-C", root, "rev-parse", "--abbrev-ref", branch + "@{upstream}"],
    { timeout: 5000 },
  ).stdout;
  if (!tracking) return st;
  const localSha = runCapture("git", ["-C", root, "rev-parse", "HEAD"], { timeout: 5000 }).stdout;
  const remoteSha = runCapture("git", ["-C", root, "rev-parse", tracking], {
    timeout: 5000,
  }).stdout;
  if (!localSha || !remoteSha) return st;
  const behind = runCapture(
    "git",
    ["-C", root, "rev-list", "--count", localSha + ".." + tracking],
    { timeout: 5000 },
  ).stdout;
  const ahead = runCapture("git", ["-C", root, "rev-list", "--count", tracking + ".." + localSha], {
    timeout: 5000,
  }).stdout;
  st.update = {
    behind: parseInt(behind || "0", 10),
    ahead: parseInt(ahead || "0", 10),
    localSha: localSha.slice(0, 7),
    remoteSha: remoteSha.slice(0, 7),
  };
  return st;
}

/** Get newest commits available upstream (for display). */
async function newestCommits(st, count = 5) {
  if (!st.update || st.update.behind <= 0) return [];
  const branch =
    runCapture("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { timeout: 5000 }).stdout ||
    "main";
  const tracking = runCapture(
    "git",
    ["-C", root, "rev-parse", "--abbrev-ref", branch + "@{upstream}"],
    { timeout: 5000 },
  ).stdout;
  if (!tracking) return [];
  const log = runCapture(
    "git",
    ["-C", root, "log", "--oneline", "-n", String(count), "HEAD.." + tracking],
    { timeout: 5000 },
  );
  return log.stdout ? log.stdout.split("\n").filter(Boolean) : [];
}

// ── Detection ───────────────────────────────────────────────────────────
async function detect() {
  const st = {
    kiro: has("kiro-cli"),
    kiroVer: null,
    built: false,
    config: false,
    agents: false,
    worker: false,
    prompts: false,
    repo: null,
    dirty: false,
    writeMode: null,
    mutation: null,
    mutationRequire: null,
  };
  if (st.kiro) {
    const v = runCapture("kiro-cli", ["--version"], { timeout: 10000 });
    st.kiroVer = v.exitCode === 0 ? v.stdout || v.stderr || "?" : null;
  }
  for (const [k, p] of [
    ["built", "dist/cli/main.js"],
    ["config", ".fabric-lite/config.json"],
    ["agents", ".kiro/agents/fabric-lite.json"],
    ["worker", ".kiro/agents/fabric-lite-worker.json"],
    ["prompts", ".kiro/prompts/.fabric-lite-manifest.json"],
  ]) {
    try {
      await access(path.join(root, p), 4);
      st[k] = true;
    } catch {}
  }
  if (st.config) {
    try {
      const cfg = JSON.parse(await readFile(path.join(root, ".fabric-lite/config.json"), "utf8"));
      const allow =
        Array.isArray(cfg?.filesystem?.allowWrite) && cfg.filesystem.allowWrite.length > 0;
      st.writeMode = allow ? "workspace" : "read";
      st.mutation = cfg?.mutation?.enabled === true;
      st.mutationRequire = cfg?.mutation?.require ?? null;
    } catch {}
  }
  const g = runCapture("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeout: 5000 });
  if (g.exitCode === 0 && g.stdout) st.repo = g.stdout;
  const dirty = runCapture("git", ["-C", root, "status", "--porcelain"], { timeout: 5000 });
  st.dirty = dirty.exitCode === 0 && dirty.stdout.trim().length > 0;
  return st;
}

function classification(st) {
  const present = [st.config, st.agents, st.worker, st.prompts].filter(Boolean).length;
  if (present === 4) return "update";
  if (present > 0 && present < 4) return "repair";
  return "install";
}

// ── Panels ──────────────────────────────────────────────────────────────
async function headerPanel(st) {
  const branch = st.repo
    ? st.repo === root
      ? "this directory"
      : path.basename(st.repo)
    : "no git repo";
  const dirty = st.dirty ? ` ${B.warn} dirty` : "";
  const lines = [
    boxRow(`📁 ${C.cyan(root)}`, C.gray("v" + VERSION)),
    boxRow(
      `🌿 ${branch}${dirty}`,
      st.kiro ? `🤖 ${C.green(st.kiroVer || "kiro-cli")}` : C.red("kiro-cli missing"),
    ),
  ];
  if (st.update) {
    if (st.update.behind > 0) {
      lines.push(
        boxRow(
          `⬇ ${C.yellow("New version available")}`,
          `${C.yellow(st.update.behind + " commit(s) behind")} ${C.dim(`(${st.update.remoteSha})`)}`,
        ),
      );
    } else if (st.update.behind === 0 && st.update.ahead === 0) {
      lines.push(boxRow(`✔ ${C.green("Up to date")}`, `${C.dim(st.update.remoteSha)}`));
    }
  }
  console.log("\n" + box("✦ Fabric Lite · Interactive Setup", lines) + "\n");
}

function statusPanel(st) {
  const rows = [
    boxRow(`Kiro CLI`, st.kiro ? `${B.ok} ${st.kiroVer || ""}` : `${B.err} not found`),
    boxRow(`Build`, st.built ? `${B.ok} dist ready` : `${B.err} not built`),
    boxRow(`Config`, st.config ? `${B.ok} present` : `${B.err} missing`),
    boxRow(`Agent`, st.agents ? `${B.ok} installed` : `${B.err} missing`),
    boxRow(`Worker agent`, st.worker ? `${B.ok} installed` : `${B.err} missing`),
    boxRow(`Prompts`, st.prompts ? `${B.ok} manifest ok` : `${B.err} missing`),
    C.gray("─".repeat(W - 2)),
    boxRow(
      `Write access`,
      st.writeMode
        ? st.writeMode === "workspace"
          ? `${B.ok} workspace`
          : `${B.err} read-only`
        : C.gray("n/a"),
    ),
    boxRow(
      `Mutations`,
      st.mutation === null
        ? C.gray("n/a")
        : st.mutation
          ? `${B.ok} enabled (${st.mutationRequire || "checkpoint"})`
          : `${B.err} disabled`,
    ),
  ];
  if (st.update && st.update.behind > 0) {
    rows.push(C.gray("─".repeat(W - 2)));
    rows.push(
      boxRow(
        `⬇ Update available`,
        `${C.yellow(`${st.update.behind} commit(s) behind`)} ${C.dim(`→ ${st.update.remoteSha}`)}`,
      ),
    );
  } else if (st.update && st.update.behind === 0) {
    rows.push(C.gray("─".repeat(W - 2)));
    rows.push(boxRow(`⬇ Latest version`, `${B.ok} up to date ${C.dim(st.update.remoteSha)}`));
  }
  console.log("\n" + box("Installation Status", rows) + "\n");
}

// ── Menu (advanced) ─────────────────────────────────────────────────────
async function menu(title, items) {
  if (!isTTY) {
    console.log(
      box(
        title,
        items.map((it, i) => `${C.cyan(String(i + 1))}. ${it.short || it.label}`),
      ),
    );
    for (;;) {
      const raw = await askLine(`  ${C.bold("Choice")} [1-${items.length}]: `);
      const n = parseInt(raw, 10);
      if (n >= 1 && n <= items.length) return items[n - 1].value;
      if (raw.toLowerCase() === "q") return "quit";
      print(`  ${C.red("Invalid choice.")}`);
    }
  }

  let selected = 0;
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  const render = () => {
    const inner = W - 4;
    const lines = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const active = i === selected;
      const marker = active ? `${B.sel} ` : "    ";
      const label = active ? C.bg(" " + (it.short || it.label)) : it.label;
      const body = `${marker}${label}`;
      lines.push(active ? "  " + pad(body, inner) : "  " + pad(body, inner));
      if (it.desc) lines.push("      " + pad(C.dim(it.desc), inner));
      if (i < items.length - 1) lines.push("");
    }
    const footer = C.dim("↑/↓ move · Enter select · Esc/q cancel");
    const content = [
      "┌" + "─".repeat(W - 2) + "┐",
      "│ " + pad(C.bold(title), W - 3) + "│",
      "├" + "─".repeat(W - 2) + "┤",
      ...lines.map((l) => "│ " + pad(l, W - 3) + "│"),
      "├" + "─".repeat(W - 2) + "┤",
      "│ " + pad(footer, W - 3) + "│",
      "└" + "─".repeat(W - 2) + "┘",
    ];
    writeOut("\x1b[H\x1b[2J\x1b[?25l" + content.join("\n") + "\n\x1b[?25h");
  };
  render();
  try {
    while (true) {
      const seg = await readKey();
      if (seg === "\x1b[A" || seg === "\x1bOA") {
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (seg === "\x1b[B" || seg === "\x1bOB") {
        selected = (selected + 1) % items.length;
        render();
      } else if (seg === "\r" || seg === "\n") {
        process.stdin.setRawMode(wasRaw);
        writeOut("\n");
        return items[selected].value;
      } else if (seg === "\x1b" || seg.toLowerCase() === "q" || seg === "\u0003") {
        process.stdin.setRawMode(wasRaw);
        writeOut("\n");
        return "quit";
      }
    }
  } catch {
    process.stdin.setRawMode(wasRaw);
    return "quit";
  }
}

async function confirm(prompt, defaultValue = true) {
  if (ASSUME_YES && defaultValue) return true;
  const hint = defaultValue ? "Y/n" : "y/N";
  for (;;) {
    const ans = (
      await askLine(`  ${C.bold(prompt)} [${hint}] ${C.gray("(enter=default, q=quit)")}: `)
    ).toLowerCase();
    if (ans === "") return defaultValue;
    if (ans === "y" || ans === "yes") return true;
    if (ans === "n" || ans === "no") return false;
    if (ans === "q") return null;
  }
}

// ── Plan ────────────────────────────────────────────────────────────────
function planPanel(kind, st, writeMode) {
  const rows = [];
  if (kind === "install") rows.push(`${B.dot} Install dependencies and build`);
  if (kind === "update") rows.push(`${B.dot} Refresh dependencies and rebuild`);
  if (kind === "repair") rows.push(`${B.dot} Complete missing components and rebuild`);
  if (kind !== "delete") {
    rows.push(`${B.dot} Install Kiro agents + prompts + config`);
    rows.push(
      `${writeMode === "workspace" ? B.ok : B.dot} Enable ${writeMode === "workspace" ? C.green("writes + mutations") : "read-only mode"} ${writeMode === "workspace" ? C.dim("(allowWrite ** · mutation checkpoint)") : ""}`,
    );
    rows.push(`${B.dot} Verify with doctor`);
  }
  rows.push(boxRow(`Target`, C.cyan(root)));
  if (st.dirty && kind !== "delete")
    rows.push(`${B.warn} Repo has uncommitted changes (left untouched)`);
  console.log("\n" + box("Plan", rows) + "\n");
}

// ── Actions ─────────────────────────────────────────────────────────────
function writeModeChoice() {
  if (ASK_WRITE === "read") return "read";
  return "workspace"; // default: fully writable
}

async function askWriteMode() {
  if (ASK_WRITE === "read" || ASK_WRITE === "workspace") return ASK_WRITE;
  return menu("Write access mode", [
    {
      label: `${C.green("Workspace (recommended)")}`,
      short: "Workspace (recommended)",
      desc: "read + write files, mutations enabled — work freely",
      value: "workspace",
    },
    {
      label: `${C.gray("Read-only")}`,
      short: "Read-only",
      desc: "reads only, no writes or mutations",
      value: "read",
    },
  ]);
}

async function buildIfNeeded(st, forceBuild) {
  if (!forceBuild && st.built) return;
  await runSteps([
    {
      label: C.dim("Installing dependencies"),
      run: () => {
        const r = runCapture("pnpm", ["install"], { cwd: root, timeout: 300000 });
        if (r.exitCode !== 0) throw new Error("pnpm install failed:\n" + (r.stderr || r.stdout));
      },
    },
    {
      label: C.dim("Building Fabric Lite"),
      run: () => {
        const r = runCapture("pnpm", ["build"], { cwd: root, timeout: 300000 });
        if (r.exitCode !== 0) throw new Error("pnpm build failed:\n" + (r.stderr || r.stdout));
      },
    },
  ]);
  st.built = true;
}

async function apply(writeMode, st) {
  const cli = path.join(root, "dist/cli/main.js");
  await runSteps([
    {
      label: C.dim("Installing agents, prompts and config"),
      run: () => {
        const args = ["install-kiro", "--format", "json"];
        if (writeMode) args.push("--allow-write", writeMode);
        if (st.agents || st.worker) args.push("--force"); // overwrite existing agent files on update/repair
        const r = runCapture(process.execPath, [cli, ...args], { cwd: root, timeout: 120000 });
        if (r.exitCode !== 0) throw new Error("install-kiro failed:\n" + (r.stderr || r.stdout));
      },
    },
    {
      label: C.dim(
        writeMode === "workspace" ? "Enabling writes + mutations" : "Applying read-only policy",
      ),
      run: () => {
        // update-policy rewrites an existing config to the requested mode,
        // which install-kiro never does on reinstall.
        const r = runCapture(
          process.execPath,
          [cli, "update-policy", "--format", "json", "--allow-write", writeMode],
          { cwd: root, timeout: 30000 },
        );
        if (r.exitCode !== 0) throw new Error("update-policy failed:\n" + (r.stderr || r.stdout));
      },
    },
  ]);
}

async function runDoctor(cli) {
  const s = await spinner(C.dim("Verifying with doctor"));
  const doc = runCapture(process.execPath, [cli, "doctor", "--format", "json"], {
    cwd: root,
    timeout: 30000,
  });
  let ok = doc.exitCode === 0,
    note = "";
  if (doc.exitCode === 0) {
    try {
      const report = JSON.parse(doc.stdout);
      ok = report.status === "healthy";
      const bad = (report.checks || []).filter((c) => !c.ok);
      note = bad.length ? bad.map((b) => b.name).join(", ") : "";
    } catch {}
  } else note = (doc.stderr || doc.stdout || "failed").slice(-200);
  s.stop(ok);
  return { ok, note };
}

function resultPanel(rows, title = "Result", color = C.green) {
  console.log("\n" + box(title, rows, { titleColor: (t) => color(C.bold(t)) }) + "\n");
}

async function actionInstall(st) {
  const writeMode = await askWriteMode();
  if (writeMode === "quit") return "quit";
  planPanel("install", st, writeMode);
  if (!(await confirm("Proceed with install?", true))) {
    print(`  ${B.info} cancelled\n`);
    return "cancelled";
  }
  await buildIfNeeded(st, false);
  await apply(writeMode, st);
  const doc = await runDoctor(path.join(root, "dist/cli/main.js"));
  const rows = [
    boxRow(`Agents`, `${B.ok} installed`),
    boxRow(
      `Write access`,
      writeMode === "workspace" ? `${B.ok} workspace (allowWrite **)` : `${B.err} read-only`,
    ),
    boxRow(
      `Mutations`,
      writeMode === "workspace" ? `${B.ok} enabled (checkpoint)` : `${B.err} disabled`,
    ),
    boxRow(`Doctor`, doc.ok ? `${B.ok} healthy` : `${B.warn} ${doc.note || "warnings"}`),
    "",
    `${B.arrow} Run: ${C.cyan("kiro-cli --agent fabric-lite")}`,
  ];
  resultPanel(
    rows,
    doc.ok ? "✓ Installation complete" : "⚠ Installed with warnings",
    doc.ok ? C.green : C.yellow,
  );
  // Return success flag so main can show the single-Quit installed screen.
  return doc.ok ? "installed" : "failed";
}

async function actionUpdate(st) {
  const writeMode = writeModeChoice();
  planPanel("update", st, writeMode);
  if (!(await confirm("Proceed with update?", true))) {
    print(`  ${B.info} cancelled\n`);
    return "cancelled";
  }
  await buildIfNeeded(st, true);
  await apply(writeMode, st);
  const doc = await runDoctor(path.join(root, "dist/cli/main.js"));
  const rows = [
    boxRow(`Agents`, `${B.ok} reinstalled`),
    boxRow(`Write access`, `${B.ok} workspace (allowWrite **)`),
    boxRow(`Mutations`, `${B.ok} enabled (checkpoint)`),
    boxRow(`Doctor`, doc.ok ? `${B.ok} healthy` : `${B.warn} ${doc.note || "warnings"}`),
    "",
    `${B.arrow} You can now modify files and run mutations.`,
  ];
  resultPanel(
    rows,
    doc.ok ? "✓ Update complete" : "⚠ Updated with warnings",
    doc.ok ? C.green : C.yellow,
  );
  print(`  ${B.info} ${C.green("Update finished — closing installer...")}\n`);
  // Auto-close: the app shuts down after a successful update.
  setTimeout(() => process.exit(0), 800);
  await new Promise(() => {});
}

async function actionRepair(st) {
  const writeMode = writeModeChoice();
  planPanel("repair", st, writeMode);
  if (!(await confirm("Proceed with repair?", true))) {
    print(`  ${B.info} cancelled\n`);
    return "cancelled";
  }
  await buildIfNeeded(st, false);
  await apply(writeMode, st);
  const doc = await runDoctor(path.join(root, "dist/cli/main.js"));
  const rows = [
    boxRow(`Components`, `${B.ok} completed`),
    boxRow(`Write access`, writeMode === "workspace" ? `${B.ok} workspace` : `${B.err} read-only`),
    boxRow(`Mutations`, writeMode === "workspace" ? `${B.ok} enabled` : `${B.err} disabled`),
    boxRow(`Doctor`, doc.ok ? `${B.ok} healthy` : `${B.warn} ${doc.note || "warnings"}`),
  ];
  resultPanel(
    rows,
    doc.ok ? "✓ Repair complete" : "⚠ Repaired with warnings",
    doc.ok ? C.green : C.yellow,
  );
  return "installed";
}

async function actionDelete(_st) {
  const targets = [
    path.join(root, ".fabric-lite"),
    path.join(root, ".kiro/agents/fabric-lite.json"),
    path.join(root, ".kiro/agents/fabric-lite-worker.json"),
    path.join(root, ".kiro/prompts/.fabric-lite-manifest.json"),
  ];
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, ".kiro/prompts/.fabric-lite-manifest.json"), "utf8"),
    );
    for (const name of Object.keys(manifest.files || {}))
      targets.push(path.join(root, ".kiro/prompts", name));
  } catch {}
  const rows = targets.map((t) => `${B.dot} ${path.relative(root, t) || t}`);
  rows.push("", C.red("This is permanent and cannot be undone."));
  console.log(
    "\n" +
      box(C.red("🗑  Delete Fabric Lite"), rows, { titleColor: (t) => C.red(C.bold(t)) }) +
      "\n",
  );
  if (ASSUME_YES) print(`  ${B.warn} ${C.red("--yes does not bypass this destructive confirm")}`);
  const sure = await confirm(C.red("Are you absolutely sure?"), false);
  if (sure !== true) {
    print(`  ${B.info} delete cancelled\n`);
    return;
  }
  // Second, stronger confirmation: the user must type the exact word.
  print(
    `  ${C.red("⚠  Final confirmation — this permanently removes all Fabric Lite files from:")} ${C.cyan(root)}`,
  );
  print(
    `  ${C.gray("Type")} ${C.yellow(C.bold("yes"))} ${C.gray("to permanently delete, or anything else / Enter to cancel.")}`,
  );
  const final = await askLine(`  ${C.bold("Type 'yes' to delete")}: `);
  if (final.trim().toLowerCase() !== "yes") {
    print(`  ${B.info} delete cancelled\n`);
    return "cancelled";
  }
  let removed = 0,
    failed = 0;
  for (const t of targets) {
    try {
      await rm(t, { recursive: true, force: true });
      removed++;
    } catch {
      failed++;
    }
  }
  // Also remove global agent registrations (~/.kiro/agents/fabric-lite*) so Kiro
  // stops offering a fabric-lite agent whose prompt points at the deleted CLI.
  let globalRemoved = 0;
  const globalAgentsDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".kiro",
    "agents",
  );
  try {
    const entries = await readdir(globalAgentsDir);
    for (const entry of entries) {
      if (entry.startsWith("fabric-lite")) {
        await rm(path.join(globalAgentsDir, entry), { force: true });
        globalRemoved++;
      }
    }
  } catch {
    // Global agents directory may not exist; nothing to clean.
  }
  try {
    const ip = path.join(root, ".gitignore");
    const ignore = await readFile(ip, "utf8");
    const lines = ignore.split(/\r?\n/);
    const f = lines.filter((l) => l !== ".fabric-lite/runs/" && l !== ".fabric-lite/cache/");
    if (f.length !== lines.length) {
      await writeFile(ip, f.join("\n"));
      print(`  ${B.ok} cleaned .gitignore`);
    }
  } catch {}
  resultPanel(
    [
      boxRow(`Removed`, `${B.ok} ${removed} files/directories`) +
        (failed ? `  ${B.warn} ${failed} failed` : ""),
      boxRow(`.gitignore`, `${B.ok} entries cleaned`),
      boxRow(
        `Global agents`,
        globalRemoved
          ? `${B.ok} ${globalRemoved} removed (~/.kiro/agents/fabric-lite*)`
          : `${B.dot} none found`,
      ),
      `${B.info} ${C.dim("To fully remove package deps run: pnpm prune")}`,
    ],
    "✓ Deleted",
    C.green,
  );
}

// ── Pull latest (git sync) ──────────────────────────────────────────────
async function actionSync(st) {
  if (!st.repo) {
    print(`  ${B.err} Not a git repo — nothing to pull.\n`);
    return;
  }
  const commits = await newestCommits(st);
  const rows = [];
  if (commits.length) {
    rows.push(`${C.yellow("New commits to pull:")}`);
    for (const c of commits) rows.push(`  ${C.dim(c)}`);
  } else {
    rows.push(`${B.ok} No incoming changes — already up to date.`);
  }
  rows.push("", boxRow(`Target`, C.cyan(root)));
  console.log("\n" + box("⬇  Pull latest from GitHub", rows) + "\n");

  if (commits.length === 0) return;
  if (st.dirty) {
    print(
      `  ${B.warn} ${C.yellow("Working tree has uncommitted changes — these will be kept (ff-only pull).")}`,
    );
  }
  if (
    !(await confirm(
      `${B.arrow} Pull latest (%s) from origin?`.replace(
        "%s",
        C.yellow(String(commits.length) + " commits"),
      ),
      true,
    ))
  ) {
    print(`  ${B.info} cancelled\n`);
    return;
  }

  const s = await spinner(C.dim("Pulling latest from origin..."));
  const res = runCapture("git", ["-C", root, "pull", "--ff-only"], { timeout: 120000 });
  s.stop(res.exitCode === 0);
  if (res.exitCode !== 0) {
    print(`  ${B.err} ${C.red("Pull failed:")} ${res.stderr || res.stdout}\n`);
    return;
  }

  // Rebuild after pulling (newer source).
  try {
    await buildIfNeeded({ built: false }, true);
  } catch (e) {
    print(`  ${B.warn} ${C.yellow("Pull succeeded but rebuild failed:")} ${e.message}`);
  }
  print(`  ${B.ok} ${C.green("Pulled latest and rebuilt. Re-run for a fresh status.")}\n`);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  if (isTTY) writeOut("\x1b[2J\x1b[H");
  if (!has("node")) {
    print(`  ${B.err} Node.js >= 20 required`);
    process.exit(1);
  }
  if (!has("pnpm")) {
    print(`  ${B.err} pnpm is required — run: ${C.cyan("corepack enable")}`);
    process.exit(1);
  }

  let st = await detect();
  // Check for updates from the remote (best-effort, background-safe fetch).
  if (st.repo) await checkRemoteUpdate(st);
  await headerPanel(st);
  if (!st.kiro) {
    statusPanel(st);
    print(`  ${B.err} ${C.red("kiro-cli was not found in PATH.")}`);
    print(`  ${B.arrow} Install it first, then re-run this script.\n`);
    process.exit(1);
  }

  for (;;) {
    statusPanel(st);
    const kind = classification(st);
    const items = [];
    if (kind === "install") {
      items.push({
        label: `${C.green("Install")}  ${C.dim("— set up Fabric Lite here")}`,
        short: `${C.green("Install")} Fabric Lite`,
        desc: "fresh setup with writes + mutations enabled",
        value: "install",
      });
    } else if (kind === "repair") {
      items.push({
        label: `${B.repair}  ${C.magenta("Repair")}  ${C.dim("— complete missing components")}`,
        short: `${B.repair} Repair installation`,
        desc: "fill gaps and enable writes",
        value: "repair",
      });
    } else {
      items.push({
        label: `${B.up}  ${C.yellow("Update")}  ${C.dim("— rebuild & reinstall agents")}`,
        short: `${B.up} Update Fabric Lite`,
        desc: "rebuild, reinstall, keep writes + mutations enabled",
        value: "update",
      });
    }
    if (kind !== "install")
      items.push({
        label: `${B.del}  ${C.red("Delete")}  ${C.dim("— remove all Fabric Lite files here")}`,
        short: `${B.del} Delete Fabric Lite`,
        desc: "remove agents, prompts, config and .gitignore entries",
        value: "delete",
      });
    if (st.repo)
      items.push({
        label: `${C.yellow("⇣  Pull latest")}  ${C.dim("— git pull from GitHub")}`,
        short: `${C.yellow("⇣")} Pull latest`,
        desc:
          st.update && st.update.behind > 0
            ? `${st.update.behind} commit(s) available`
            : "check for and pull newest source",
        value: "sync",
      });
    items.push({
      label: `${B.q}  ${C.gray("Quit")}`,
      short: `${B.q} Quit`,
      desc: "exit without changes",
      value: "quit",
    });

    let choice;
    try {
      choice = await menu("What would you like to do?", items);
    } catch {
      break;
    }
    if (choice === "quit") {
      print(`\n  ${B.info} Goodbye!\n`);
      break;
    }
    let actionResult = "";
    try {
      if (choice === "install") actionResult = await actionInstall(st);
      else if (choice === "repair") actionResult = await actionRepair(st);
      else if (choice === "update") actionResult = await actionUpdate(st);
      else if (choice === "delete") actionResult = await actionDelete(st);
      else if (choice === "sync") actionResult = await actionSync(st);
    } catch (e) {
      print(`  ${B.err} ${C.red(e.message || e)}\n`);
    }

    // After install/repair completes, show the installed screen with only Quit.
    if (actionResult === "installed") {
      await installedScreen(st);
      break;
    }
    const next = await detect();
    Object.assign(st, next);
    if (!isTTY) print("");
  }
}

/** Post-install screen: "App installed" message with only a Quit option. */
async function installedScreen(_st) {
  const rows = [
    C.green(C.bold("✓ App installed successfully!")),
    "",
    `${B.arrow} Run: ${C.cyan("kiro-cli --agent fabric-lite")}`,
    `${B.arrow} Write access + mutations are enabled.`,
  ];
  console.log("\n" + box("🎉 Installation complete", rows) + "\n");
  await menu("App installed — what next?", [
    {
      label: `${B.q}  ${C.gray("Quit")}`,
      short: `${B.q} Quit`,
      desc: "close the installer",
      value: "quit",
    },
  ]);
  print(`\n  ${B.info} Goodbye!\n`);
}

main().catch((e) => {
  print(`  ${B.err} ${C.red(e.message || e)}`);
  process.exit(1);
});
