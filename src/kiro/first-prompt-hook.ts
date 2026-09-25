import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FIRST_PROMPT_GUIDANCE } from "./first-prompt-guidance.js";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const fail = (): never => { throw new Error("Fabric first-prompt hook requires valid session input and private, owned state storage"); };

function privateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) fail();
}

/** @internal Live context implementation used by runFirstPromptHook. Direct
 * fixture tests exercise exact claim/storage failures without replacing stdin
 * or weakening the CLI's generic, non-disclosing error boundary. Not root-exported.
 * Claim before output: retries/resume never append a second copy. The hook has
 * no delivery acknowledgement, so a crash after the claim can omit injection. */
export function firstPromptContext(input: unknown, dataRoot: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const event = input as Record<string, unknown>;
  if (event.hook_event_name !== "UserPromptSubmit" && event.hook_event_name !== "userPromptSubmit") return fail();
  if (typeof event.session_id !== "string" || event.session_id.length < 1 || event.session_id.length > 256 ||
      /[\u0000-\u0020\u007f]/u.test(event.session_id) || typeof event.prompt !== "string") return fail();
  if (!event.prompt.trim()) return "";
  if (!path.isAbsolute(dataRoot) || path.resolve(dataRoot) !== dataRoot) return fail();
  privateDirectory(dataRoot);
  const directory = path.join(dataRoot, "first-prompts");
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  privateDirectory(directory);
  // Session identity, not prompt text, workspace or generation: concurrent chats
  // are independent and resuming/updating an existing chat does not reinject.
  const key = createHash("sha256").update("fabric-first-prompt\0").update(event.session_id).digest("hex");
  const marker = path.join(directory, `${key}.json`);
  let fd: number;
  try { fd = fs.openSync(marker, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 || stat.size > 256) return fail();
    return "";
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, guidanceSha256: createHash("sha256").update(FIRST_PROMPT_GUIDANCE).digest("hex") }) + "\n");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  // Persist the directory entry before emitting. Never expire markers: a resumed
  // old session must still get no second copy of the startup instructions.
  const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  return FIRST_PROMPT_GUIDANCE;
}

export async function runFirstPromptHook(dataRoot: string | undefined): Promise<number> {
  try {
    if (!dataRoot) return fail();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) return fail();
      chunks.push(bytes);
    }
    const context = firstPromptContext(JSON.parse(Buffer.concat(chunks).toString("utf8")), dataRoot);
    if (context) await new Promise<void>((resolve, reject) => {
      process.stdout.write(context + "\n", error => error ? reject(error) : resolve());
    });
    return 0;
  } catch {
    // Input can contain credentials. Neither raw input nor exception text belongs
    // in hook diagnostics. Failure emits no block; Kiro owns error presentation.
    process.stderr.write("Fabric first-prompt hook failed; check session input and private state storage.\n");
    return 1;
  }
}
