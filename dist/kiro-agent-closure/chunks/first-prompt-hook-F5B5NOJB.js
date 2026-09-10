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
var FIRST_PROMPT_PROGRAM = String.raw`const [guidance, manifest] = await Promise.all([
  fabric.help({topic:"review"}),
  local.find({path:".",pattern:"**/*",hidden:true,limit:200}),
]);
const patterns = [
  {area:"guidance", match:/(^|\/)(AGENTS\.md|README(?:\.md)?)$/i},
  {area:"entrypoints", match:/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Makefile|Dockerfile)$/},
  {area:"automation", match:/(^|\/)([^/]*pipeline[^/]*\.ya?ml|\.gitlab-ci\.yml)$|(^|\/)(\.github\/workflows|\.azure-pipelines)\/.*\.ya?ml$/i},
  {area:"overrides", match:/(^|\/)(envs?|environments|overlays)\/.*\.ya?ml$|(^|\/)values[.-][^/]+\.ya?ml$/i},
  {area:"configuration", match:/(^|\/)(Chart|values(?:[.-][^/]+)?|deployment|docker-compose|compose)\.ya?ml$/i},
  {area:"templates", match:/(^|\/)templates\/.*\.(ya?ml|tpl)$/i},
  {area:"checks", match:/(^|\/)(tests?|__tests__|spec|validations)\/.*\.(ts|tsx|js|py|go|rs|cs|sh|ps1)$|\.(test|spec)\.[cm]?[jt]sx?$/i},
  {area:"implementation", match:/\.(?:[cm]?[jt]sx?|py|go|rs|cs|java|sh|ps1|tf)$/i},
];
const paths = [...manifest.paths].sort((a,b) => a.split("/").length-b.split("/").length || a.localeCompare(b));
const seen = new Set<string>();
const areas = patterns.map(({area,match}) => ({area, paths:paths.filter(path => {
  if (seen.has(path) || !match.test(path) || /(^|\/)(secrets?([./_-]|$)|credentials?([./_-]|$)|\.env(\.|$))|\.(pem|key)$/i.test(path)) return false;
  seen.add(path); return true;
})})).filter(group => group.paths.length);
const maxChars = Math.floor(Math.min(24000,40000-JSON.stringify({guidance,manifest,areas}).length-1000)/Math.max(1,areas.length));
if (maxChars < 1000) return {guidance,manifest,narrowDiscovery:true};
const packets = await parallel(areas, async ({area,paths}): Promise<JsonObject> => {
  const windows = paths.slice(0,3).map(path => ({path,limit:160}));
  try {
    return {area,evidence:await local.readMany({windows,maxChars}),deferred:paths.slice(3)};
  } catch (error) {
    return {area,error:error instanceof Error ? error.message : String(error),unread:paths};
  }
},{concurrency:3});
return {guidance,manifest,packets};`;
var FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Apply this once-per-chat method to the user's actual task. Preserve their scope, tool restrictions, edit authorization and output format. Simple questions need no audit. Review requests authorize investigation and reporting, not edits.

Before your first tool program, identify the outcome, the important unknowns and what evidence would distinguish causes. For coding, establish the affected path and acceptance checks before editing. For broad reviews, use the discovery/read starter below, or adapt it to gather equivalent evidence. Do not spend separate turns listing already-discovered directories, formatting results or narrating plans.

\`\`\`ts
${FIRST_PROMPT_PROGRAM}
\`\`\`

This is an initial sample, not a completed review. Each area gets a separate source budget so a long README cannot consume the implementation packet. Selection is heuristic: follow references and inspect relevant manifest paths outside these groups too. Credential-looking paths are deferred from automatic reading; inspect relevant storage/consumers with redacted evidence.

After receiving the packet:
1. Inspect evidence before choosing the next program. Track areas, unread ranges and open leads. Follow evidence.remaining exactly; for whole-file coverage use nextOffset and hash. Never invent offsets or reread prefixes. Partition discovery when truncated or narrowDiscovery is true; follow truncated help. complete refers only to requested ranges.
2. Gather related evidence together: caller + executable code + defaults/overrides + consumer/tests. For a deployment repo this includes environment values AND templates, maintenance scripts and CI callers. Trace inputs -> selected object -> guard -> effect -> reported outcome. A few findings are not a stopping condition; close relevant accessible areas and retained leads, or report the specific limit.
3. Challenge each consequential claim before reporting it. Use an actual parser, render, test or stubbed execution when runtime semantics decide the answer. A tool call containing comments, constant output or a rewritten imitation of the suspect code is not verification. Preserve the original causal path and exit status, test a counterexample, and check that the proposed correction also works. Use local.shell({script,interpreter:"bash",args}) for literal Bash; JSON.stringify is not shell quoting. Keep probes offline and do not run deployment/cleanup against services.
4. Match confidence to evidence beside each finding: source mismatch, reproduced behavior under stated inputs, or conditional risk. Check external settings, upstream validation and unavailable application schemas before saying always/never. Do not turn a dropped argument into an assumed empty response, or a typo into a guaranteed crash. Report observed behavior, not invented downstream effects.
5. Before finalizing, reconcile coverage and leads: supported finding, rejected with evidence, or unresolved check. Do not claim to have inspected every file from a listing or partial reads. Rank by demonstrated impact; include file:line, trigger, concise evidence and a correction that follows from it. State uninspected scope and checks not run. No findings is a valid outcome.

Use the returned review help for detailed recipes; do not reload known guidance. local.readMany defaults to 32000 aggregate JSON characters, maximum 40000, subject to runtime limits; reserve room for other returned data. Keep ranges, hashes, failures and continuations. Use inferred types or JsonObject, not Record<string, unknown>. Return evidence that changes a decision; never use an empty or analysis-only exec as a reasoning step.

Continue from this investigation state on later turns; do not append this block again. These are workflow instructions, not a model or reasoning-effort override. They cannot force Auto routing or guarantee review quality.
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
