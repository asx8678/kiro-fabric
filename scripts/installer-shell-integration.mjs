import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { installerSafety as s } from "./install-agent-user.mjs";
import { acquireInstallationLock } from "./installer-lock.mjs";
import { syncDirectory } from "./install-transaction.mjs";

const marker = "# >>> kiro-fabric workspace handoff v1";
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const statePath = home => path.join(home, "kiro-fabric", "shell-integration.json");

// The client shell, not the MCP backend, grants its current directory on each
// invocation. No executable replacement, fixed project path, or global export.
function block(home) {
  return `\n${marker}\nif ! typeset -f kiro-cli >/dev/null 2>&1 && ! alias kiro-cli >/dev/null 2>&1; then
  function kiro-cli {
    local arg fabric_v3=0 fabric_agent=0 fabric_workspace
    for arg in "$@"; do
      case "$arg" in
        --) break ;;
        --v3) fabric_v3=1 ;;
        --agent|--agent=*|-a|-a?*) fabric_agent=1 ;;
      esac
    done
    if [ "$fabric_v3" = 1 ] && [ -f ${quote(path.join(home, "agents", "kiro-fabric.json"))} ]; then
      fabric_workspace="$(pwd -P)" || return $?
      if [ "$fabric_agent" = 0 ]; then
        KIRO_HOME=${quote(home)} KIRO_FABRIC_LAUNCH_WORKSPACE="$fabric_workspace" command kiro-cli --agent kiro-fabric "$@"
      else
        KIRO_FABRIC_LAUNCH_WORKSPACE="$fabric_workspace" command kiro-cli "$@"
      fi
    else
      command kiro-cli "$@"
    fi
  }
else
  printf '%s\\n' 'Kiro Fabric: existing kiro-cli alias/function preserved; use kiro-fabric start for workspace binding.' >&2
fi
# <<< kiro-fabric workspace handoff v1\n`;
}
function readSafe(file) {
  s.assertNoUnsafeSymlinkComponents(file);
  s.assertSafeDirectory(path.dirname(file));
  if (!s.lstat(file)) return null;
  if (s.assertSafeFile(file, "shell integration file").size > 1024 * 1024) throw new Error(`Shell integration file exceeds bound: ${file}`);
  const bytes = fs.readFileSync(file);
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) throw new Error(`Shell integration requires UTF-8: ${file}`);
  return bytes;
}

/** Read-only and bounded; conflicts are reported before backend activation. */
export function planShellIntegration(home, { env = process.env, userHome = env.HOME ?? os.homedir(), remove = false, disabled = false } = {}) {
  if (disabled) return { status: "skipped", reason: "Shell integration disabled; use the installed kiro-fabric start launcher." };
  const state = statePath(home);
  s.assertNoUnsafeSymlinkComponents(state);
  const saved = s.lstat(state) ? JSON.parse(readSafe(state).toString("utf8")) : null;
  const shell = path.basename(env.SHELL ?? "");
  if (!saved && remove) return { status: "skipped", reason: "No managed shell integration." };
  if (!saved && !["bash", "zsh"].includes(shell)) return { status: "skipped", reason: "SHELL is not bash/zsh; use the installed kiro-fabric start launcher (no startup file changed)." };
  const directory = shell === "zsh" && env.ZDOTDIR ? env.ZDOTDIR : userHome;
  const file = saved?.file ?? path.join(directory, shell === "zsh" ? ".zshrc" : ".bashrc");
  if (typeof file !== "string" || !path.isAbsolute(file) || /[\u0000-\u001f\u007f]/u.test(file) || ![".zshrc", ".bashrc"].includes(path.basename(file))) throw new Error("Unsafe shell startup path");
  if (!saved && (!path.isAbsolute(directory) || /[\u0000-\u001f\u007f]/u.test(directory))) throw new Error("Shell home/ZDOTDIR must be an absolute safe directory");
  const content = readSafe(file), text = content?.toString("utf8") ?? "", managed = block(home);
  if (saved && (saved.schemaVersion !== 1 || saved.home !== home || typeof saved.created !== "boolean" || !/^[a-f0-9]{64}$/u.test(saved.beforeSha256 ?? "") || typeof saved.backup !== "string" || !saved.backup.startsWith(file + ".kiro-fabric-backup-") || path.dirname(saved.backup) !== path.dirname(file))) throw new Error("Invalid shell integration ownership record");
  const index = text.indexOf(managed);
  const without = index < 0 ? text : text.slice(0, index) + text.slice(index + managed.length);
  if (without.includes("kiro-fabric workspace handoff") || (index >= 0 && !saved)) throw new Error(`Unowned or modified Fabric shell block preserved: ${file}`);
  if (saved && index < 0 && s.hash(content ?? Buffer.alloc(0)) !== saved.beforeSha256 && !(remove && s.hash(content ?? Buffer.alloc(0)) === saved.removalSha256)) throw new Error(`Managed shell block changed; startup file preserved: ${file}`);
  if (!saved && /(?:\balias\s+kiro-cli\s*=|\bfunction\s+kiro-cli\b|\bkiro-cli\s*\(\s*\))/u.test(text)) throw new Error(`Existing kiro-cli alias/function preserved in ${file}; use --no-shell-integration or reconcile it before installing`);
  return { status: "planned", file, content, managed, remove, state, saved, next: remove ? without : index >= 0 ? text : text + managed };
}

/** Separate recoverable post-commit step; failures must not hide backend commit. */
export function applyShellIntegration(home, plan) {
  if (plan.status !== "planned") return plan;
  const release = acquireInstallationLock(path.join(home, "kiro-fabric"));
  try {
    const current = readSafe(plan.file);
    if ((current === null) !== (plan.content === null) || (current && !current.equals(plan.content))) throw new Error(`Shell startup changed during installation: ${plan.file}`);
    const recorded = s.lstat(plan.state) ? JSON.parse(readSafe(plan.state).toString("utf8")) : null;
    if (JSON.stringify(recorded) !== JSON.stringify(plan.saved)) throw new Error("Shell integration ownership changed during installation");
    let saved = plan.saved;
    if (!saved) {
      const backup = plan.file + ".kiro-fabric-backup-" + randomBytes(8).toString("hex");
      fs.writeFileSync(backup, current ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
      const fd = fs.openSync(backup, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      syncDirectory(path.dirname(backup));
      saved = { schemaVersion: 1, home, file: plan.file, backup, created: current === null, beforeSha256: s.hash(current ?? Buffer.alloc(0)) };
      // Record before modifying rc: an interrupted append is retryable.
      s.atomicWrite(plan.state, Buffer.from(JSON.stringify(saved) + "\n"));
    }
    if (plan.remove) {
      saved = { ...saved, removalSha256: s.hash(Buffer.from(plan.next)) };
      s.atomicWrite(plan.state, Buffer.from(JSON.stringify(saved) + "\n"));
    }
    if (plan.remove && saved.created && plan.next === "") {
      if (s.lstat(plan.file)) fs.unlinkSync(plan.file);
      syncDirectory(path.dirname(plan.file));
    } else if (plan.next !== (current?.toString("utf8") ?? "")) s.atomicWrite(plan.file, Buffer.from(plan.next));
    if (plan.remove) { fs.unlinkSync(plan.state); syncDirectory(path.dirname(plan.state)); }
    return { status: plan.remove ? "removed" : "configured", file: plan.file, backup: saved.backup, restartRequired: true };
  } finally { release(); }
}
