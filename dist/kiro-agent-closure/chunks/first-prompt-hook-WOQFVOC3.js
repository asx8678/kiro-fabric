import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import "./chunk-AE4E2KSU.js";

// src/kiro/first-prompt-hook.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// src/kiro/first-prompt-guidance.ts
var FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Kiro Fabric uses Code Mode: only fabric_exec with checked TypeScript. Discover as needed with tools.providers(), tools.search and tools.describe; load only relevant schemas.
Assess complexity from uncertainty, dependencies and impact. Identify outcomes, constraints and acceptance checks; preserve scope, tool restrictions and output format.
For code, use Navigator repo.focusRead({query}) or repo.focus({query}) for known targets, repo.sketch({}) otherwise, and repo.impact({files}) before edits/review conclusions. Read source; graphs are untrusted hints. Reuse evidence, refresh after changes, and disclose gaps before bounded local fallback.
Resume the next unresolved check; verify authorized changes and required builds. Stop at acceptance or report exact blockers.
</fabric_initial_investigation>
`.trim();

// src/kiro/first-prompt-hook.ts
var MAX_INPUT_BYTES = 2 * 1024 * 1024;
var fail = () => {
  throw new Error("Fabric first-prompt hook requires valid session input and private, owned state storage");
};
function privateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0) fail();
}
function firstPromptContext(input, dataRoot) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const event = input;
  if (event.hook_event_name !== "UserPromptSubmit" && event.hook_event_name !== "userPromptSubmit") return fail();
  if (typeof event.session_id !== "string" || event.session_id.length < 1 || event.session_id.length > 256 || /[\u0000-\u0020\u007f]/u.test(event.session_id) || typeof event.prompt !== "string") return fail();
  if (!event.prompt.trim()) return "";
  if (!path.isAbsolute(dataRoot) || path.resolve(dataRoot) !== dataRoot) return fail();
  privateDirectory(dataRoot);
  const directory = path.join(dataRoot, "first-prompts");
  try {
    fs.mkdirSync(directory, { mode: 448 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateDirectory(directory);
  const key = createHash("sha256").update("fabric-first-prompt\0").update(event.session_id).digest("hex");
  const marker = path.join(directory, `${key}.json`);
  let fd;
  try {
    fd = fs.openSync(marker, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 384);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0 || stat.size > 256) return fail();
    return "";
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, guidanceSha256: createHash("sha256").update(FIRST_PROMPT_GUIDANCE).digest("hex") }) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
  return FIRST_PROMPT_GUIDANCE;
}
async function runFirstPromptHook(dataRoot) {
  try {
    if (!dataRoot) return fail();
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) return fail();
      chunks.push(bytes);
    }
    const context = firstPromptContext(JSON.parse(Buffer.concat(chunks).toString("utf8")), dataRoot);
    if (context) await new Promise((resolve, reject) => {
      process.stdout.write(context + "\n", (error) => error ? reject(error) : resolve());
    });
    return 0;
  } catch {
    process.stderr.write("Fabric first-prompt hook failed; check session input and private state storage.\n");
    return 1;
  }
}
export {
  firstPromptContext,
  runFirstPromptHook
};
