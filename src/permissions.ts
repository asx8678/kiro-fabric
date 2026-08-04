import { createInterface } from "node:readline";
import { createReadStream, createWriteStream } from "node:fs";
import { realpath } from "node:fs/promises";

/**
 * Every operation is classified before it can reach a host side effect.
 * Read is fixed-allow and destructive is fixed-deny. Lexical shell detection
 * is defense-in-depth only; generic approved shell can still be destructive,
 * so the human approval boundary remains authoritative.
 */
export type PermissionCategory = "read" | "commit" | "execute" | "network" | "destructive";
export type PermissionPolicy = "allow" | "ask" | "deny";

export interface PermissionsPolicy {
  read: PermissionPolicy;
  commit: PermissionPolicy;
  execute: PermissionPolicy;
  network: PermissionPolicy;
  destructive: PermissionPolicy;
}

export const defaultPermissions: PermissionsPolicy = {
  read: "allow",
  commit: "ask",
  execute: "ask",
  network: "ask",
  destructive: "deny",
};

export type ApprovalResponse = "allow" | "session" | "deny";

export interface PermissionRequest {
  category: PermissionCategory;
  /** Structured, collision-free identity used for session/allowlist matching. */
  action: string;
  /** Bounded, truthful preview shown to the human before approval. */
  preview: string;
  /** Shell metadata used to enforce the project-root allowlist restriction. */
  command?: string;
  cwd?: string;
}

export type ApprovalPrompter = (request: PermissionRequest) => Promise<ApprovalResponse>;
const MAX_PREVIEW_CHARS = 4096;

function bounded(text: string, max = MAX_PREVIEW_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 32)}… [truncated]`;
}

function structuredPreview(label: string, value: unknown): string {
  return bounded(`${label} ${JSON.stringify(value)}`);
}

/** Defense-in-depth detector, not a proof that an approved shell is safe. */
function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) { tokens.push(token); token = ""; }
    } else if (";&|()".includes(char)) {
      if (token) { tokens.push(token); token = ""; }
      tokens.push(char);
    } else {
      token += char;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function executableName(token: string): string {
  return token.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
}

function hasDestructiveRm(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (executableName(tokens[i]!) !== "rm" && executableName(tokens[i]!) !== "rm.exe") continue;
    let recursive = false;
    let force = false;
    for (let j = i + 1; j < tokens.length && !";&|()".includes(tokens[j]!); j++) {
      const arg = tokens[j]!.toLowerCase();
      if (arg === "--recursive" || arg === "--dir" || arg === "-r" || (/^-[^-]/.test(arg) && arg.includes("r"))) recursive = true;
      if (arg === "--force" || arg === "-f" || (/^-[^-]/.test(arg) && arg.includes("f"))) force = true;
    }
    if (recursive || force) return true;
  }
  return false;
}

function hasNestedShell(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const name = executableName(tokens[i]!);
    if (!["sh", "bash", "zsh", "dash", "ksh", "sh.exe", "bash.exe", "zsh.exe", "dash.exe", "ksh.exe"].includes(name)) continue;
    for (let j = i + 1; j < tokens.length && !";&|()".includes(tokens[j]!); j++) {
      if (tokens[j] === "-c" || tokens[j] === "--command") return true;
    }
  }
  return false;
}

function hasDestructiveGit(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (executableName(tokens[i]!) !== "git") continue;
    // Git accepts global options before the subcommand. Scan the whole command
    // segment rather than assuming the subcommand is token two: a safe-looking
    // option such as --no-pager or -c key=value must not hide a mutation.
    for (let j = i + 1; j < tokens.length && !";&|()".includes(tokens[j]!); j++) {
      if (["push", "reset", "clean"].includes(executableName(tokens[j]!))) return true;
    }
  }
  return false;
}

export function isDestructive(command: string): boolean {
  const text = command.trim();
  // Command substitutions can execute an arbitrary hidden command. Treat all
  // forms conservatively as destructive, including substitutions in quotes.
  if (text.includes("$(") || text.includes("`")) return true;
  const tokens = shellTokens(text);
  if (hasDestructiveRm(tokens) || hasNestedShell(tokens) || hasDestructiveGit(tokens)) return true;
  if (/\bfind\b[^;&|\n]*\s-delete\b/i.test(text)) return true;
  if (/\bkubectl\b(?:\s+[^;&|\n]*)?\s+(?:delete|apply)\b/i.test(text)) return true;
  if (/\bterraform\b(?:\s+[^;&|\n]*)?\s+(?:apply|destroy)\b/i.test(text)) return true;
  if (/(^|[\s;&|])(?:mkfs(?:\.[\w-]+)?|dd\s+(?:if|of)=|shutdown\b|reboot\b)/i.test(text)) return true;
  // Mutating SQL, including common statements passed through command wrappers.
  return /\b(?:insert\s+into|update\s+[a-z0-9_.`"]+\s+set|delete\s+from|drop\s+(?:database|table|schema|view|index)|truncate\b|alter\s+|create\s+(?:database|table|schema|index|view)|merge\s+into|grant\s+|revoke\s+|vacuum\b)\b/i.test(text.toLowerCase());
}

export function classifyShell(command: string, cwd = "."): { category: PermissionCategory; preview: string } {
  return {
    category: isDestructive(command) ? "destructive" : "execute",
    preview: shellPreview(command, cwd),
  };
}

export function shellRequest(command: string, cwd: string): PermissionRequest {
  const identity = { operation: "shell", cwd, command };
  return {
    category: isDestructive(command) ? "destructive" : "execute",
    action: JSON.stringify(identity),
    preview: structuredPreview("shell", identity),
    command,
    cwd,
  };
}

function shellPreview(command: string, cwd: string): string {
  return structuredPreview("shell", { cwd, command });
}

export function commitRequest(message: string, repository: string, paths: string[]): PermissionRequest {
  const identity = { operation: "local-commit", repository, message, paths: [...paths] };
  return {
    category: "commit",
    action: JSON.stringify(identity),
    preview: structuredPreview("local explicit-path commit", identity),
  };
}

export function networkRequest(tool: string, operation: string, argv: readonly string[]): PermissionRequest {
  const identity = { operation: "network-inspection", tool, name: operation, argv: [...argv] };
  return {
    category: "network",
    action: JSON.stringify(identity),
    preview: structuredPreview("network inspection", identity),
  };
}

export const headlessPrompter: ApprovalPrompter = async () => "deny";

/** Interactive approval always uses /dev/tty and fails closed if it is absent. */
export const interactivePrompter: ApprovalPrompter = async (request) => {
  let input: ReturnType<typeof createReadStream> | undefined;
  let output: ReturnType<typeof createWriteStream> | undefined;
  try {
    input = createReadStream("/dev/tty");
    output = createWriteStream("/dev/tty");
    const rl = createInterface({ input, output });
    const failed = new Promise<ApprovalResponse>((resolve) => {
      rl.once("error", () => resolve("deny"));
      input?.once("error", () => resolve("deny"));
      output?.once("error", () => resolve("deny"));
    });
    const answered = new Promise<ApprovalResponse>((resolve) => {
      rl.question(
        `\nFabric permission [${request.category}]\n${request.preview}\nAllow once (a) / Allow session (s) / Deny (d): `,
        (answer) => {
          const value = answer.trim().toLowerCase();
          resolve(value === "a" || value === "allow" || value === "once" ? "allow" : value === "s" || value === "session" ? "session" : "deny");
        },
      );
    });
    return await Promise.race([failed, answered]).finally(() => rl.close());
  } catch {
    return "deny";
  } finally {
    input?.destroy();
    output?.destroy();
  }
};

export interface PermissionGateOptions {
  policy: PermissionsPolicy;
  prompter?: ApprovalPrompter;
  allowedCommands?: readonly string[];
  /** Canonical project root required for shell allowlist preapproval. */
  projectRoot?: string;
}

export class PermissionGate {
  private readonly prompter: ApprovalPrompter;
  private readonly session = new Set<PermissionCategory>();
  private promptTail: Promise<void> = Promise.resolve();
  private canonicalRoot?: Promise<string | undefined>;

  constructor(private readonly options: PermissionGateOptions) {
    this.prompter = options.prompter ?? headlessPrompter;
  }

  private async serializedPrompt(request: PermissionRequest): Promise<ApprovalResponse> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.promptTail;
    this.promptTail = turn;
    await previous;
    try {
      // Session authorization is deliberately category-wide, matching Fabric:
      // it grants this risk category for the lifetime of this gate/process.
      if (this.session.has(request.category)) return "session";
      const response = await this.prompter(request);
      if (response === "session") this.session.add(request.category);
      return response;
    } finally {
      release();
    }
  }

  /** Canonicalize the project root once so allowlist cwd comparison
   *  survives symlinked paths (e.g. /var vs /private/var on macOS). */
  private projectRoot(): Promise<string | undefined> {
    this.canonicalRoot ??= this.options.projectRoot === undefined
      ? Promise.resolve(undefined)
      : realpath(this.options.projectRoot).catch(() => this.options.projectRoot);
    return this.canonicalRoot;
  }

  async authorize(request: PermissionRequest): Promise<boolean> {
    if (request.category === "read") return true;
    if (request.category === "destructive") return false;
    const policy = this.options.policy[request.category];
    // Deny is checked before every allowlist or session path.
    if (policy === "deny") return false;
    if (
      request.category === "execute" &&
      request.cwd !== undefined &&
      request.cwd === await this.projectRoot() &&
      request.command !== undefined &&
      this.options.allowedCommands?.includes(request.command)
    ) return true;
    if (policy === "allow") return true;
    const response = await this.serializedPrompt(request);
    return response === "allow" || response === "session";
  }
}

export function createPermissionGate(options: PermissionGateOptions): PermissionGate {
  return new PermissionGate(options);
}