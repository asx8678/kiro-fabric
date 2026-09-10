/** A checked example, also executed against fixtures in first-prompt tests. */
export const FIRST_PROMPT_PROGRAM = String.raw`const [guidance, manifest] = await Promise.all([
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

/** Injected into the first submitted message, never into the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
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
