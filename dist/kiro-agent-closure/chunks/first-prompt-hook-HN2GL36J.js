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
const groups = [
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)README(?:\.md)?$/i,
  /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/,
  /(^|\/)(azure-pipelines[^/]*\.ya?ml|[^/]*pipeline\.ya?ml|compose\.ya?ml|docker-compose\.ya?ml)$/,
  /(^|\/)(Chart\.yaml|values\.yaml|deployment\.ya?ml)$/,
];
const candidates = [...new Set(groups.flatMap(pattern => manifest.paths.filter(path => pattern.test(path))))];
const selected = candidates.slice(0,12);
const budget = Math.max(1000,Math.min(20000,40000-JSON.stringify({guidance,manifest,candidates}).length));
const evidence = selected.length
  ? await local.readMany({windows:selected.map(path => ({path,limit:200})),maxChars:budget})
  : {files:[],remaining:[],complete:true};
return {guidance,manifest,evidence,deferredCandidates:candidates.slice(selected.length)};`;
var FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
This is the user's once-per-chat Fabric investigation preference. Apply it to the actual request above. It adds a method, not new scope or authority. Explicit user constraints on tools, files, edits, time and output take precedence over every example below. A question, translation or small edit does not require a repository audit. For a review, investigate and report; do not make changes unless the user authorized them. Continue using Fabric Code Mode throughout the chat.

For repository reviews and difficult debugging or implementation tasks, perform a thorough investigation of the relevant system before committing to a diagnosis or edit. The challenge is to establish causes across files, configuration layers and execution boundaries. A convincing result explains what happens under reachable inputs and rules out plausible alternative explanations. A long list of suspicions is not evidence of completeness.

Plan the evidence before writing the tool program

Determine the requested outcome, what is already known, the uncertainties that matter, and the observations that would distinguish competing explanations. Keep a concise working ledger of relevant areas, received source ranges, open leads, verification and blockers. Use it to direct work; do not print a long planning monologue or your private reasoning. For coding, establish acceptance conditions and inspect the affected path before editing. For review, identify the repository's role and the limits of the available implementation.

Make the initial investigation informative

When a broad repository review needs orientation, combine guidance, hidden-aware discovery and a bounded packet of observed entrypoints in one execution. Discover before reading guessed paths. Independent reads can run together; mechanically dependent discovery and located reads can also share a program. Reserve a model decision for interpreting evidence and choosing the next relevant packet. Do not add a tool round trip merely to reformat a result.

The following is a starting example for an unfamiliar repository review. Adapt its file selection to the user's scope; it does not cover every language or prove whole-repository coverage. Skip orientation that has already been done, and do not run it when the task does not call for repository inspection.

\`\`\`ts
${FIRST_PROMPT_PROGRAM}
\`\`\`

Inspect guidance and manifest truncation, deferred candidates, every file's received range and evidence.remaining. Follow exact continuations instead of rereading the initial packet. A manifest lists candidates; a fetched file still needs analysis. After orientation, assemble callers, implementation, configuration and relevant tests together. Include hidden CI and maintenance paths where relevant. If the first packet does not reveal the implementation, trace references to it instead of treating launchers as the whole system.

Use the interfaces as declared. local.readMany normally needs no maxChars: its default is 32000 aggregate JSON characters and its maximum is 40000, subject to smaller runtime budgets. The example reserves space because it also returns discovery and guidance. Respect output limits when composing results. Keep scope, truncation, hashes and continuation metadata. Use inferred result types or JsonObject for dynamic JSON dictionaries, not Record<string, unknown>. Await provider calls and inspect every failure. Do not hide compiler errors with unsafe casts or JSON round-tripping.

Trace behavior across boundaries

For each relevant path, follow entrypoint -> arguments -> configuration precedence -> selected object -> guard -> effect -> reported outcome. Check successful, failing, empty and partial inputs where they change behavior. Compare dry-run and mutation paths. Check whether a guard protects the same object that is acted upon. Verify names, types, casing, selectors, ports, authorization resource/API-group/verb tuples and supported overrides against their consumers. For deployments, inspect rendered behavior and what actually changes on an update. For alerts, check both creation of the rule and whether its expression can match the intended data.

Treat external schemas, variable groups, controllers, application defaults and service responses as unresolved when they are unavailable. A commented value may be supplied elsewhere. An incorrect credential mapping proves a mismatch, not an observed authentication failure. Missing application source cannot prove a response property absent. Source syntax that resembles a familiar bug is a lead to verify, not a reproduced failure. Search relevant callers with hidden:true and retain search scope before saying a validator or setting is unused.

Collect decisive evidence and seek counterexamples

For each consequential candidate identify the location, trigger, first incorrect value or action, expected behavior, observed evidence and unresolved dependencies. Try to disprove it using upstream validation, effective overrides, alternate ownership and runtime semantics. Use small offline probes when they can settle uncertainty: render configuration, exercise a pure function, or stub external effects while preserving the actual causal path. Do not run deployment or cleanup scripts against services during a review.

Use local.shell({script,interpreter:"bash",args}) for literal Bash probes. JSON.stringify is not shell quoting. Preserve the tested command's exit status before diagnostics; a trailing echo or grep can replace it. Test representative successful and failing inputs through the same path. A render confirms what it renders, not cluster admission, deployment success or application behavior. A stub confirms the substituted case, not an unknown production response. If a runtime or schema is unavailable, keep that claim conditional rather than inventing certainty.

Close the investigation with a skeptical pass

Reconcile retained leads against the coverage ledger. Report a supported issue, reject it with a counterexample, or identify the missing check. Do not silently drop a supported contract mismatch from an already-read file. On a small accessible repository, inspect relevant operational and security boundaries before stopping at the first few plausible bugs. Inspect credential storage and allowlists through redacted locations and metadata; do not print or test credentials. No fixed number of findings is required, and no findings is a valid outcome.

Rank findings by demonstrated impact and reachability. Separate reproduced behavior, source-level defects and conditional risks beside each claim. Recheck assertions such as always, never, cannot, live and every therefore. Keep conditions consistent between findings. Include precise file locations, the triggering condition, concise evidence and the smallest correction that follows from it. State relevant uninspected scope and checks not run. Follow the requested output format and keep progress messages brief while completing the necessary work.

These instructions express the desired investigation depth. They do not select a model, change reasoning settings, or establish which model Auto routed to. Do not claim routing, quality or token-cost guarantees from this block. Do not append or reload this startup block on later turns; use the investigation state and the user's subsequent instructions.
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
