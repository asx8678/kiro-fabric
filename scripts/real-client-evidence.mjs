import { createHash } from "node:crypto";
import path from "node:path";
import { generateAgentProfile } from "./agent-profile.mjs";

export const REAL_CLIENT_INTERACTIVE_COMMAND = ["kiro-cli", "--v3", "--agent", "kiro-fabric"];
export const REAL_CLIENT_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
export const REAL_CLIENT_NATIVE_TOOLS = ["read", "write", "shell", "web", "subagent", "todo_list"];
export const REAL_CLIENT_PROFILE_TOOLS = [...REAL_CLIENT_NATIVE_TOOLS, "@fabric"];
export const REAL_CLIENT_MANUAL_COMPACTION_CYCLES = 3;
export const REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES = 1;
export const REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS = 24_000;
export const REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS = 12;
export const REAL_CLIENT_TRANSCRIPT_KINDS = [
  "archive-installation",
  "kiro-version",
  "kiro-help-all",
  "kiro-chat-help",
  "kiro-agent-validate-help",
  "agent-validation-workspace",
  "agent-list-workspace",
  "agent-validation-unrelated",
  "agent-list-unrelated",
  "agent-validation-nested",
  "agent-list-nested",
  "resource-inheritance-setting",
  "automatic-compaction-setting",
  "form-probe-start",
  "form-probe-mcp-startup",
  "form-probe-trace-request",
  "form-probe-trace-response",
  "form-probe-request",
  "form-probe-response",
  "form-probe-shutdown",
  "interactive-start",
  "interactive-tools",
  "interactive-mcp-startup",
  "interactive-turn-1",
  "interactive-turn-2",
  "interactive-turn-3",
  "interactive-context-seed-acp-call",
  "interactive-session-id",
  "interactive-compaction",
  "interactive-compaction-acp-event",
  "interactive-compaction-series-acp-events",
  "interactive-context-source-acp-event",
  "interactive-post-compaction-session-id",
  "interactive-post-compaction",
  "interactive-post-compaction-acp-call",
  "interactive-manual-compaction-2-context-seed",
  "interactive-manual-compaction-2",
  "interactive-manual-compaction-2-session-id",
  "interactive-post-manual-compaction-2",
  "interactive-manual-compaction-3-context-seed",
  "interactive-manual-compaction-3",
  "interactive-manual-compaction-3-session-id",
  "interactive-post-manual-compaction-3",
  "interactive-automatic-compaction-context-seed",
  "interactive-automatic-compaction-pressure",
  "interactive-automatic-compaction-session-id",
  "interactive-post-automatic-compaction",
  "interactive-compaction-cycle-context-sources",
  "interactive-compaction-cycle-acp-calls",
  "interactive-shutdown",
  "resume-start",
  "resume-mcp-startup",
  "resume-session-id",
  "resume-turn",
  "resume-acp-call",
  "resume-shutdown",
  "headless-selection",
  "automatic-compaction-setting-final",
];

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const MCP_INSTANCE_ID = /^fmcp_[a-f0-9]{32}$/u;
const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} message @returns {never} */
const fail = (message) => { throw new Error(`invalid real-client evidence: ${message}`); };

/** @param {unknown} value @returns {unknown} */
const canonicalValue = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
  }
  fail("qualification value is not canonical JSON");
};
const valueDigest = (value) => digest(Buffer.from(JSON.stringify(canonicalValue(value))));

export const transcriptEntry = (kind, bytes) => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > 128_000) throw new Error(`real-client transcript ${kind} exceeds 128000 bytes`);
  return { kind, encoding: "base64", bytes: buffer.length, digest: digest(buffer), raw: buffer.toString("base64") };
};

const verifyTranscript = (entries) => {
  if (!Array.isArray(entries) || entries.length !== REAL_CLIENT_TRANSCRIPT_KINDS.length) fail("transcript is incomplete");
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.kind !== REAL_CLIENT_TRANSCRIPT_KINDS[index] || entry.encoding !== "base64" || typeof entry.raw !== "string") fail("transcript identity is invalid");
    const bytes = Buffer.from(entry.raw, "base64");
    if (bytes.toString("base64") !== entry.raw || bytes.length !== entry.bytes || bytes.length > 128_000 || digest(bytes) !== entry.digest) fail("transcript digest is invalid");
    total += bytes.length;
  }
  if (total > 768_000) fail("transcript exceeds its byte budget");
};

const command = (value, label) => {
  if (!value || typeof value.executable !== "string" || !path.isAbsolute(value.executable) ||
      !Array.isArray(value.argv) || value.argv.some((part) => typeof part !== "string" || part.includes("\0"))) fail(`${label} command is invalid`);
  return value;
};

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

const exactKiroCommand = (value, label, executable, argv) => {
  const found = command(value, label);
  if (found.executable !== executable || !equal(found.argv, argv)) fail(`${label} command is not the exact supported argv`);
  return found;
};

const identity = (value, label) => {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isSafeInteger(value.parentPid) || value.parentPid <= 0 ||
      !MCP_INSTANCE_ID.test(value.mcpInstanceId ?? "") || !Number.isFinite(Date.parse(value.startedAt ?? "")) || value.runtimeGeneration !== 1) {
    fail(`${label} lifecycle identity is invalid`);
  }
  return value;
};

const sameIdentity = (left, right) => left.pid === right.pid && left.parentPid === right.parentPid &&
  left.mcpInstanceId === right.mcpInstanceId && left.startedAt === right.startedAt &&
  left.runtimeGeneration === right.runtimeGeneration;

const descendantPids = (value, label) => {
  if (!Array.isArray(value) || value.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || new Set(value).size !== value.length) {
    fail(`${label} descendant process evidence is invalid`);
  }
  return value;
};

const exactFabricExecEvidence = (value, label, sessionId, recordingDigest, expectedResult) => {
  if (!value || value.sessionId !== sessionId || typeof value.toolCallId !== "string" ||
      value.toolCallId.length < 1 || value.toolCallId.length > 256 ||
      !SHA256.test(value.expectedArgumentsDigest ?? "") || value.observedArgumentsDigest !== value.expectedArgumentsDigest ||
      value.expectedResultDigest !== valueDigest(expectedResult) || value.observedResultDigest !== value.expectedResultDigest ||
      !Array.isArray(value.frameDigests) || value.frameDigests.length < 1 ||
      value.frameDigests.some((frameDigest) => !SHA256.test(frameDigest)) || new Set(value.frameDigests).size !== value.frameDigests.length ||
      value.acpRecordingDigest !== recordingDigest || !SHA256.test(value.outputDigest ?? "")) {
    fail(`${label} fabric_exec evidence is incomplete`);
  }
  return value;
};

export const assertRealClientEvidence = (report, packageDigest, options = {}) => {
  if (!report || typeof report !== "object") fail("report must be an object");
  if (options.qualification === true && (report.kind !== "kiro-fabric.real-client-qualification" || report.schemaVersion !== 12 || report.ok !== true)) fail("qualification identity is invalid");
  if (report.packageDigest !== packageDigest || !SHA256.test(report.packageDigest)) fail("package digest is invalid");
  if (!options.archiveDigest || report.archiveDigest !== options.archiveDigest || !SHA256.test(report.archiveDigest)) fail("archive digest is invalid");
  if (!options.commit || report.commit !== options.commit || !GIT_OBJECT_ID.test(report.commit)) fail("commit is invalid");
  if (Object.hasOwn(report, "powerActivated") || Object.hasOwn(report, "customAgentSelected")) fail("model self-attestation fields are forbidden");
  if (!equal(report.tools, REAL_CLIENT_TOOLS)) fail("Fabric tool surface is invalid");

  const authentication = report.authentication;
  const apiKeyAuthentication = authentication?.mode === "api-key" &&
    authentication.verification === "authenticated-kiro-commands" &&
    authentication.subscriptionLoginPerformed === false &&
    authentication.preLoginUnauthenticated === false;
  const subscriptionAuthentication = authentication?.mode === "subscription" &&
    authentication.verification === "kiro-cli-whoami" &&
    typeof authentication.subscriptionLoginPerformed === "boolean" &&
    authentication.preLoginUnauthenticated === authentication.subscriptionLoginPerformed;
  if (authentication?.isolatedHome !== true || (!apiKeyAuthentication && !subscriptionAuthentication)) {
    fail("real-client authentication evidence is invalid");
  }

  const installation = report.installation;
  if (!installation || ![installation.releaseRoot, installation.kiroHome, installation.profile, installation.runtime, installation.data, installation.nodePath].every((value) => typeof value === "string" && path.isAbsolute(value)) ||
      installation.packageDigest !== packageDigest || !SHA256.test(installation.profileDigest ?? "") ||
      !options.runtimeDigest || installation.runtimeDigest !== options.runtimeDigest || !SHA256.test(installation.runtimeDigest ?? "") ||
      !options.skillDigest || installation.skillDigest !== options.skillDigest || !SHA256.test(installation.skillDigest ?? "") ||
      installation.finalProfileDigest !== installation.profileDigest || installation.finalRuntimeDigest !== installation.runtimeDigest ||
      installation.finalSkillDigest !== installation.skillDigest ||
      installation.workspaceBeforeDigest !== installation.workspaceAfterInstallDigest || !SHA256.test(installation.workspaceBeforeDigest ?? "") ||
      installation.workspaceProfileAbsent !== true || installation.releaseProfileAbsent !== true) fail("isolated archive installation evidence is invalid");
  const installedRoot = path.join(installation.kiroHome, "kiro-fabric");
  if (installation.profile !== path.join(installation.kiroHome, "agents", "kiro-fabric.json") ||
      installation.runtime !== path.join(installedRoot, "runtime", packageDigest) ||
      installation.data !== path.join(installedRoot, "data") ||
      within(installation.releaseRoot, installation.profile) || within(installation.releaseRoot, installation.runtime) || within(installation.releaseRoot, installation.data)) {
    fail("installed files are not an independent global Agent installation");
  }

  const kiro = report.kiro;
  if (!kiro || typeof kiro.path !== "string" || !path.isAbsolute(kiro.path) || !SHA256.test(kiro.digest ?? "") ||
      typeof kiro.version !== "string" || !kiro.version || !["--agent-engine", "--engine", "--v3"].includes(kiro.headlessEngineSelector) ||
      !["--path", "positional"].includes(kiro.agentValidateSyntax)) fail("Kiro binary/help identity is incomplete");
  if (!SHA256.test(report.driver?.digest ?? "") || report.driver?.version !== "repository-driver-v10") fail("driver identity is invalid");

  const gates = report.qualificationGates;
  const nativeVisibility = gates?.nativeToolVisibility;
  if (!nativeVisibility || nativeVisibility.source !== "kiro-tui-/tools" || nativeVisibility.command !== "/tools" ||
      nativeVisibility.observed !== true || !equal(nativeVisibility.profileTools, REAL_CLIENT_PROFILE_TOOLS) ||
      !equal(nativeVisibility.nativeTools, REAL_CLIENT_NATIVE_TOOLS) || !equal(nativeVisibility.fabricTools, REAL_CLIENT_TOOLS) ||
      !SHA256.test(nativeVisibility.outputDigest ?? "")) fail("native tool visibility gate is incomplete");
  const formGate = gates?.formElicitation;
  if (!formGate || formGate.source !== "kiro-tui-form" || formGate.observed !== true || formGate.requestCount !== 1 ||
      formGate.responseCount !== 1 || formGate.terminalPromptObserved !== true || formGate.terminalResponseObserved !== true || formGate.approved !== false ||
      formGate.failedClosed !== true || formGate.acpStructuralEventObserved !== true || !SHA256.test(formGate.acpRecordingDigest ?? "") ||
      !SHA256.test(formGate.requestOutputDigest ?? "") || !SHA256.test(formGate.responseOutputDigest ?? "")) {
    fail("form elicitation gate is incomplete");
  }
  const compactionGate = gates?.compaction;
  if (!compactionGate || compactionGate.source !== "kiro-acp-command-exchange" || compactionGate.observed !== true ||
      compactionGate.eventCount !== 1 || compactionGate.method !== "_kiro.dev/compaction/status" ||
      compactionGate.status !== "completed" || !SESSION_ID.test(compactionGate.sessionId ?? "") ||
      !SHA256.test(compactionGate.frameDigest ?? "") || !SHA256.test(compactionGate.acpRecordingDigest ?? "") ||
      !SHA256.test(compactionGate.eventOutputDigest ?? "") || !Number.isSafeInteger(compactionGate.intervalStartOffset) ||
      !Number.isSafeInteger(compactionGate.intervalEndOffset) || compactionGate.intervalStartOffset < 1 ||
      compactionGate.intervalEndOffset <= compactionGate.intervalStartOffset ||
      compactionGate.manualExchange?.sessionId !== compactionGate.sessionId || compactionGate.manualExchange?.command !== "/compact" ||
      ![compactionGate.manualExchange?.requestIdDigest, compactionGate.manualExchange?.requestFrameDigest,
        compactionGate.manualExchange?.startedFrameDigest, compactionGate.manualExchange?.completedFrameDigest,
        compactionGate.manualExchange?.responseFrameDigest, compactionGate.manualExchange?.responseResultDigest].every((value) => SHA256.test(value ?? "")) ||
      compactionGate.manualExchange.completedFrameDigest !== compactionGate.frameDigest ||
      compactionGate.manualExchange.responseSuccess !== true) {
    fail("structural ACP compaction gate is incomplete");
  }
  const compactionSeries = gates?.compactionSeries;
  if (!compactionSeries || compactionSeries.source !== "kiro-acp-repeated-manual-and-natural-automatic" ||
      compactionSeries.observed !== true || compactionSeries.manualCycleCount !== REAL_CLIENT_MANUAL_COMPACTION_CYCLES ||
      compactionSeries.automaticCycleCount !== REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES ||
      !SHA256.test(compactionSeries.acpRecordingDigest ?? "") || !SHA256.test(compactionSeries.eventOutputDigest ?? "") ||
      !SHA256.test(compactionSeries.automaticPressureOutputDigest ?? "") ||
      !Array.isArray(compactionSeries.manual) || compactionSeries.manual.length !== REAL_CLIENT_MANUAL_COMPACTION_CYCLES) {
    fail("repeated compaction series gate is incomplete");
  }
  let previousIntervalEnd = 0;
  for (const [offset, cycle] of compactionSeries.manual.entries()) {
    const index = offset + 1;
    if (!cycle || cycle.index !== index || cycle.command !== "/compact" || cycle.eventCount !== 1 ||
        cycle.method !== "_kiro.dev/compaction/status" || cycle.status !== "completed" ||
        !SESSION_ID.test(cycle.sessionIdBefore ?? "") || cycle.sessionId !== cycle.sessionIdBefore ||
        !SESSION_ID.test(cycle.sessionIdAfter ?? "") || cycle.sessionIdChanged !== (cycle.sessionIdBefore !== cycle.sessionIdAfter) ||
        !SHA256.test(cycle.frameDigest ?? "") || !Number.isSafeInteger(cycle.intervalStartOffset) ||
        !Number.isSafeInteger(cycle.intervalEndOffset) || cycle.intervalStartOffset <= previousIntervalEnd ||
        cycle.intervalEndOffset <= cycle.intervalStartOffset || cycle.manualExchange?.sessionId !== cycle.sessionIdBefore ||
        cycle.manualExchange?.command !== "/compact" || cycle.manualExchange?.completedFrameDigest !== cycle.frameDigest ||
        cycle.manualExchange?.responseSuccess !== true ||
        ![cycle.manualExchange?.requestIdDigest, cycle.manualExchange?.requestFrameDigest,
          cycle.manualExchange?.startedFrameDigest, cycle.manualExchange?.completedFrameDigest,
          cycle.manualExchange?.responseFrameDigest, cycle.manualExchange?.responseResultDigest]
          .every((value) => SHA256.test(value ?? ""))) {
      fail(`manual compaction series cycle ${index} is incomplete`);
    }
    if (offset > 0 && compactionSeries.manual[offset - 1].sessionIdAfter !== cycle.sessionIdBefore) {
      fail("manual compaction series session continuity is invalid");
    }
    previousIntervalEnd = cycle.intervalEndOffset;
  }
  const firstSeriesCycle = compactionSeries.manual[0];
  if (firstSeriesCycle.sessionId !== compactionGate.sessionId || firstSeriesCycle.frameDigest !== compactionGate.frameDigest ||
      firstSeriesCycle.intervalStartOffset !== compactionGate.intervalStartOffset ||
      firstSeriesCycle.intervalEndOffset !== compactionGate.intervalEndOffset ||
      !equal(firstSeriesCycle.manualExchange, compactionGate.manualExchange)) {
    fail("first manual compaction is not bound to the repeated series");
  }
  const automaticCompactionGate = compactionSeries.automatic;
  if (!automaticCompactionGate || automaticCompactionGate.trigger !== "natural-context-pressure" ||
      automaticCompactionGate.eventCount !== 1 || automaticCompactionGate.method !== "_kiro.dev/compaction/status" ||
      automaticCompactionGate.status !== "completed" || !SESSION_ID.test(automaticCompactionGate.sessionIdBefore ?? "") ||
      automaticCompactionGate.sessionId !== automaticCompactionGate.sessionIdBefore ||
      automaticCompactionGate.sessionIdBefore !== compactionSeries.manual.at(-1)?.sessionIdAfter ||
      !SESSION_ID.test(automaticCompactionGate.sessionIdAfter ?? "") ||
      automaticCompactionGate.sessionIdChanged !== (automaticCompactionGate.sessionIdBefore !== automaticCompactionGate.sessionIdAfter) ||
      !SHA256.test(automaticCompactionGate.frameDigest ?? "") ||
      automaticCompactionGate.frameDigest !== automaticCompactionGate.completedFrameDigest ||
      ![automaticCompactionGate.pressureMarkerDigest, automaticCompactionGate.promptRequestIdDigest,
        automaticCompactionGate.promptFrameDigest, automaticCompactionGate.startedFrameDigest,
        automaticCompactionGate.completedFrameDigest].every((value) => SHA256.test(value ?? "")) ||
      automaticCompactionGate.manualCommandAbsent !== true || automaticCompactionGate.toolCallsAbsent !== true ||
      automaticCompactionGate.settingMutated !== false || !Number.isSafeInteger(automaticCompactionGate.pressureTurns) ||
      automaticCompactionGate.pressureTurns < 1 || automaticCompactionGate.pressureTurns > REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS ||
      !Number.isSafeInteger(automaticCompactionGate.totalPressureChars) ||
      automaticCompactionGate.totalPressureChars < automaticCompactionGate.pressureTurns * REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS ||
      automaticCompactionGate.totalPressureChars > automaticCompactionGate.pressureTurns * (REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS + 512) ||
      !Number.isSafeInteger(automaticCompactionGate.intervalStartOffset) ||
      !Number.isSafeInteger(automaticCompactionGate.intervalEndOffset) ||
      automaticCompactionGate.intervalStartOffset <= previousIntervalEnd ||
      automaticCompactionGate.intervalEndOffset <= automaticCompactionGate.intervalStartOffset) {
    fail("natural automatic compaction gate is incomplete");
  }
  const continuityGate = gates?.conversationContinuity;
  if (!continuityGate || continuityGate.source !== "kiro-acp-resume" || continuityGate.observed !== true ||
      !SESSION_ID.test(continuityGate.sessionIdBeforeResume ?? "") || continuityGate.sessionIdBeforeResume !== continuityGate.sessionIdAfterResume ||
      continuityGate.acpSessionLoadObserved !== true ||
      !SHA256.test(continuityGate.interactiveRecordingDigest ?? "") || !SHA256.test(continuityGate.resumeRecordingDigest ?? "")) {
    fail("conversation continuity gate is incomplete");
  }
  const compactedFact = continuityGate.compactedFact;
  if (!compactedFact || compactedFact.source !== "kiro-acp-precompact-prompt-to-fabric-exec" || compactedFact.observed !== true ||
      !SHA256.test(compactedFact.factDigest ?? "") || !SHA256.test(compactedFact.preCompactionPromptFrameDigest ?? "") ||
      !SESSION_ID.test(compactedFact.preCompactionSessionId ?? "") ||
      typeof compactedFact.postCompactionToolCallId !== "string" || !compactedFact.postCompactionToolCallId ||
      typeof compactedFact.contextSeedToolCallId !== "string" || !compactedFact.contextSeedToolCallId ||
      !SHA256.test(compactedFact.postCompactionArgumentsDigest ?? "") || compactedFact.durableEffectObserved !== true ||
      compactedFact.factAbsentFromPreCompactionToolData !== true ||
      !SHA256.test(compactedFact.sourceOutputDigest ?? "")) fail("compacted conversational fact evidence is incomplete");
  const compactedFacts = continuityGate.compactedFacts;
  const expectedCompactedFactIdentities = [
    { kind: "manual", cycle: 1, sessionId: compactionSeries.manual[0].sessionIdBefore },
    { kind: "manual", cycle: 2, sessionId: compactionSeries.manual[1].sessionIdBefore },
    { kind: "manual", cycle: 3, sessionId: compactionSeries.manual[2].sessionIdBefore },
    { kind: "automatic", cycle: 1, sessionId: automaticCompactionGate.sessionIdBefore },
  ];
  if (!Array.isArray(compactedFacts) || compactedFacts.length !== expectedCompactedFactIdentities.length ||
      !SHA256.test(continuityGate.compactedFactsOutputDigest ?? "")) {
    fail("compaction-series conversational fact evidence is incomplete");
  }
  for (const [index, fact] of compactedFacts.entries()) {
    const expected = expectedCompactedFactIdentities[index];
    if (!fact || fact.kind !== expected.kind || fact.cycle !== expected.cycle ||
        fact.source !== "kiro-acp-precompact-prompt-to-fabric-exec" || fact.observed !== true ||
        fact.preCompactionSessionId !== expected.sessionId || !SHA256.test(fact.factDigest ?? "") ||
        !SHA256.test(fact.preCompactionPromptFrameDigest ?? "") ||
        typeof fact.postCompactionToolCallId !== "string" || !fact.postCompactionToolCallId ||
        typeof fact.contextSeedToolCallId !== "string" || !fact.contextSeedToolCallId ||
        !SHA256.test(fact.postCompactionArgumentsDigest ?? "") ||
        fact.factAbsentFromPreCompactionToolData !== true || fact.durableEffectObserved !== true) {
      fail(`compaction-series conversational fact ${index + 1} is incomplete`);
    }
  }
  const { sourceOutputDigest: _legacySourceDigest, ...legacyCompactedFact } = compactedFact;
  if (!equal(legacyCompactedFact, compactedFacts[0]) ||
      new Set(compactedFacts.map((fact) => fact.factDigest)).size !== compactedFacts.length ||
      new Set(compactedFacts.map((fact) => fact.preCompactionPromptFrameDigest)).size !== compactedFacts.length) {
    fail("compacted conversational fact series is not unique and legacy-bound");
  }
  const fabricExecGate = gates?.fabricExecIntegrity;
  if (!fabricExecGate || fabricExecGate.source !== "kiro-acp-session-tool-call" || fabricExecGate.observed !== true ||
      !fabricExecGate.contextSeed || !fabricExecGate.postCompaction || !fabricExecGate.resume) fail("fabric_exec integrity gate is incomplete");

  const commands = report.commands;
  const installCommand = command(commands?.install, "archive installation");
  if (!/(?:^|[/\\])node(?:\.exe)?$/iu.test(installCommand.executable) ||
      installCommand.resolvedExecutable !== installation.nodePath ||
      !/(?:^|[/\\])node(?:\.exe)?$/iu.test(installation.nodePath) ||
      !equal(installCommand.argv, [path.join(installation.releaseRoot, "scripts", "install-agent-user.mjs"), installation.releaseRoot])) {
    fail("archive installation command is not exact");
  }
  const expectedProfile = generateAgentProfile({
    nodePath: installation.nodePath,
    runtimeRoot: installation.runtime,
    dataRoot: installation.data,
    skillPath: path.join(installedRoot, "skills", "fabric-exec", "SKILL.md"),
  });
  if (installation.profileDigest !== digest(Buffer.from(`${JSON.stringify(expectedProfile, null, 2)}\n`))) {
    fail("installed profile digest is not bound to the complete generated Agent contract");
  }
  exactKiroCommand(commands?.interactive, "interactive", kiro.path, REAL_CLIENT_INTERACTIVE_COMMAND.slice(1));
  const headlessCommand = command(commands?.headless, "headless");
  const headlessPrompt = headlessCommand.argv.at(-1);
  if (headlessCommand.executable !== kiro.path || typeof headlessPrompt !== "string" || !headlessPrompt || headlessPrompt.startsWith("-") || headlessCommand.argv.includes("--trust-all-tools")) fail("headless command is invalid");
  const engineSequence = kiro.headlessEngineSelector === "--v3" ? ["--v3"] : [kiro.headlessEngineSelector, "v3"];
  if (!equal(headlessCommand.argv, ["chat", ...engineSequence, "--agent", "kiro-fabric", "--no-interactive", "--require-mcp-startup", "--output-format", "stream-json", headlessPrompt])) fail("headless command is not the exact supported positional-prompt argv");
  exactKiroCommand(commands?.resume, "resume", kiro.path, ["--v3", "--agent", "kiro-fabric", "--resume-id", report.lifecycle?.sessionId]);
  exactKiroCommand(commands?.inheritance, "resource inheritance", kiro.path, ["settings", "chat.disableInheritingDefaultResources", "--format", "json"]);
  exactKiroCommand(commands?.autoCompaction, "automatic compaction", kiro.path, ["settings", "chat.disableAutoCompaction", "--format", "json"]);
  exactKiroCommand(commands?.autoCompactionFinal, "final automatic compaction", kiro.path, ["settings", "chat.disableAutoCompaction", "--format", "json"]);
  exactKiroCommand(commands?.version, "version", kiro.path, ["--version"]);
  exactKiroCommand(commands?.helpAll, "top-level help", kiro.path, ["--help-all"]);
  exactKiroCommand(commands?.chatHelp, "chat help", kiro.path, ["chat", "--help"]);
  exactKiroCommand(commands?.agentValidateHelp, "agent validate help", kiro.path, ["agent", "validate", "--help"]);
  exactKiroCommand(commands?.formProbe, "form probe", kiro.path, REAL_CLIENT_INTERACTIVE_COMMAND.slice(1));

  const contexts = commands?.validationContexts;
  if (!Array.isArray(contexts) || contexts.length !== 3 || !report.workspace || contexts[0]?.cwd !== report.workspace.path ||
      !contexts.every((context) => typeof context?.cwd === "string" && path.isAbsolute(context.cwd)) ||
      within(report.workspace.path, contexts[1].cwd) || within(contexts[1].cwd, report.workspace.path) ||
      !within(contexts[1].cwd, contexts[2].cwd) || contexts[1].cwd === contexts[2].cwd) {
    fail("global resolution contexts are invalid");
  }
  const validateArgv = kiro.agentValidateSyntax === "--path"
    ? ["agent", "validate", "--path", installation.profile]
    : ["agent", "validate", installation.profile];
  for (const [index, context] of contexts.entries()) {
    exactKiroCommand(context.validate, `validation context ${index}`, kiro.path, validateArgv);
    exactKiroCommand(context.list, `agent list context ${index}`, kiro.path, ["agent", "list"]);
  }

  const lifecycle = report.lifecycle;
  if (!lifecycle || !SESSION_ID.test(lifecycle.sessionId ?? "") || lifecycle.totalMcpStartupCount !== 4) fail("Kiro session/startup identity is invalid");
  const formProbe = lifecycle.formProbe;
  const formIdentity = identity(formProbe?.mcp, "form probe MCP");
  descendantPids(formProbe?.observedDescendantPids, "form probe");
  if (!Number.isSafeInteger(formProbe?.kiroPid) || formProbe.kiroPid <= 0 || formIdentity.parentPid !== formProbe.kiroPid ||
      formProbe.startupCount !== 1 || formProbe.requestCount !== 1 || formProbe.responseCount !== 1 ||
      !/^form_[a-f0-9]{16}$/u.test(formProbe.elicitationId ?? "") ||
      !["accept", "decline", "cancel"].includes(formProbe.responseAction) || formProbe.approved !== false ||
      formProbe.execFailedClosed !== true || formProbe.exited !== true || formProbe.noOrphan !== true ||
      formProbe.clientCapabilities?.roots !== true || formProbe.clientCapabilities?.formElicitation !== true ||
      !SHA256.test(formProbe.traceDigest ?? "")) fail("real TUI form-probe lifecycle is incomplete");
  const headless = lifecycle.headless;
  const headlessIdentity = identity(headless?.mcp, "headless MCP");
  if (!Number.isSafeInteger(headless?.kiroPid) || headless.kiroPid <= 0 || headlessIdentity.parentPid !== headless.kiroPid || headless.startupCount !== 1 || headless.exited !== true || headless.noOrphan !== true || !SHA256.test(headless.traceDigest ?? "")) fail("headless lifecycle is incomplete");
  const interactive = lifecycle.interactive;
  const interactiveIdentity = identity(interactive?.mcp, "interactive MCP");
  descendantPids(interactive?.observedDescendantPids, "interactive");
  if (!Number.isSafeInteger(interactive?.kiroPid) || interactive.kiroPid <= 0 || interactiveIdentity.parentPid !== interactive.kiroPid || interactive.startupCount !== 1 || interactive.exited !== true || interactive.noOrphan !== true || !SHA256.test(interactive.traceDigest ?? "") ||
      interactive.clientCapabilities?.roots !== true || interactive.clientCapabilities?.formElicitation !== true ||
      !Array.isArray(interactive.turns) || !equal(interactive.turns.map((turn) => turn.name), [
        "turn-1",
        "turn-2",
        "turn-3",
        "post-compaction",
        "manual-compaction-2-context-seed",
        "post-manual-compaction-2",
        "manual-compaction-3-context-seed",
        "post-manual-compaction-3",
        "automatic-compaction-context-seed",
        "post-automatic-compaction",
      ])) fail("interactive lifecycle is incomplete");
  for (const turn of interactive.turns) {
    if (!sameIdentity(identity(turn.mcp, `interactive ${turn.name}`), interactiveIdentity) || turn.fabricInfoCalls < 1 || turn.fabricExecCalls !== 1 || turn.execSucceeded !== true) fail(`interactive ${turn.name} did not preserve one Fabric runtime`);
  }
  if (interactive.compaction?.command !== "/compact" || interactive.compaction.completed !== true ||
      !SESSION_ID.test(interactive.compaction.sessionIdBefore ?? "") ||
      interactive.compaction.sessionIdAfter !== firstSeriesCycle.sessionIdAfter ||
      interactive.compaction.sessionIdChanged !== (interactive.compaction.sessionIdBefore !== interactive.compaction.sessionIdAfter) ||
      !sameIdentity(identity(interactive.compaction.mcp, "compaction MCP"), interactiveIdentity)) fail("compaction lifecycle is incomplete");
  if (![interactive.compaction.sessionIdBefore, interactive.compaction.sessionIdAfter].includes(compactionGate.sessionId)) {
    fail("structural ACP compaction event is not session-bound");
  }
  if (compactionGate.manualExchange.sessionId !== interactive.compaction.sessionIdBefore) {
    fail("manual compaction command is not bound to the pre-compaction Kiro session");
  }
  if (!Array.isArray(interactive.manualCompactions) ||
      interactive.manualCompactions.length !== REAL_CLIENT_MANUAL_COMPACTION_CYCLES) {
    fail("repeated manual compaction lifecycle is incomplete");
  }
  for (const [offset, cycle] of interactive.manualCompactions.entries()) {
    const gateCycle = compactionSeries.manual[offset];
    if (cycle?.index !== offset + 1 || cycle.command !== "/compact" || cycle.completed !== true ||
        cycle.sessionIdBefore !== gateCycle.sessionIdBefore || cycle.sessionIdAfter !== gateCycle.sessionIdAfter ||
        cycle.sessionIdChanged !== gateCycle.sessionIdChanged ||
        !sameIdentity(identity(cycle.mcp, `manual compaction cycle ${offset + 1} MCP`), interactiveIdentity)) {
      fail(`manual compaction lifecycle cycle ${offset + 1} is incomplete`);
    }
  }
  if (interactive.automaticCompaction?.trigger !== "natural-context-pressure" ||
      interactive.automaticCompaction.completed !== true || interactive.automaticCompaction.settingMutated !== false ||
      interactive.automaticCompaction.pressureTurns !== automaticCompactionGate.pressureTurns ||
      interactive.automaticCompaction.sessionIdBefore !== automaticCompactionGate.sessionIdBefore ||
      interactive.automaticCompaction.sessionIdAfter !== automaticCompactionGate.sessionIdAfter ||
      interactive.automaticCompaction.sessionIdChanged !== automaticCompactionGate.sessionIdChanged ||
      !sameIdentity(identity(interactive.automaticCompaction?.mcp, "automatic compaction MCP"), interactiveIdentity) ||
      lifecycle.sessionId !== automaticCompactionGate.sessionIdAfter) {
    fail("automatic compaction lifecycle is incomplete");
  }
  if (interactive.durableSentinels?.memory !== true || interactive.durableSentinels?.state !== true || interactive.ephemeralArtifact?.sameProcessReadable !== true || interactive.ephemeralArtifact?.removedAtShutdown !== true) fail("interactive sentinel evidence is incomplete");

  const resumed = lifecycle.resumed;
  const resumedIdentity = identity(resumed?.mcp, "resumed MCP");
  descendantPids(resumed?.observedDescendantPids, "resumed");
  if (!Number.isSafeInteger(resumed?.kiroPid) || resumed.kiroPid <= 0 || resumedIdentity.parentPid !== resumed.kiroPid || resumed.sessionId !== lifecycle.sessionId || resumed.startupCount !== 1 || resumed.exited !== true || resumed.noOrphan !== true || !SHA256.test(resumed.traceDigest ?? "") ||
      resumedIdentity.pid === interactiveIdentity.pid || resumedIdentity.mcpInstanceId === interactiveIdentity.mcpInstanceId || resumedIdentity.runtimeGeneration !== 1 ||
      resumed.durableMemoryRestored !== true || resumed.durableStateRestored !== true || resumed.ephemeralArtifactUnavailable !== true || resumed.execSucceeded !== true) fail("resumed lifecycle is incomplete");
  if ([headlessIdentity.mcpInstanceId, interactiveIdentity.mcpInstanceId, resumedIdentity.mcpInstanceId, formIdentity.mcpInstanceId].some((value, index, values) => values.indexOf(value) !== index)) fail("separate Kiro processes reused an MCP instance identity");

  if ((report.resources?.disableInheritingDefaultResources !== null && report.resources?.disableInheritingDefaultResources !== false) ||
      report.resources?.defaultResourcesInherited !== true) fail("effective default-resource inheritance was not recorded");
  if ((report.resources?.disableAutoCompaction !== null && report.resources?.disableAutoCompaction !== false) ||
      report.resources?.disableAutoCompactionAfter !== report.resources?.disableAutoCompaction ||
      report.resources?.autoCompactionEnabled !== true || report.resources?.autoCompactionSettingMutated !== false) {
    fail("effective automatic-compaction setting was not recorded without mutation");
  }
  for (const name of ["formProbe", "interactive", "resume"]) {
    const recording = report.recordings?.[name];
    if (!recording || !Number.isSafeInteger(recording.bytes) || recording.bytes < 1 || !SHA256.test(recording.digest ?? "")) fail(`${name} ACP recording identity is invalid`);
  }
  if (compactionGate.intervalEndOffset > report.recordings.interactive.bytes) fail("manual compaction interval exceeds its ACP recording");
  if (compactionSeries.acpRecordingDigest !== report.recordings.interactive.digest ||
      compactionSeries.manual.some((cycle) => cycle.intervalEndOffset > report.recordings.interactive.bytes) ||
      automaticCompactionGate.intervalEndOffset > report.recordings.interactive.bytes) {
    fail("compaction series exceeds or is not bound to its ACP recording");
  }
  const contextSeedCall = exactFabricExecEvidence(
    fabricExecGate.contextSeed,
    "context-seed",
    interactive.compaction.sessionIdBefore,
    report.recordings.interactive.digest,
    { verified: true },
  );
  const postCompactionCall = exactFabricExecEvidence(
    fabricExecGate.postCompaction,
    "post-compaction",
    firstSeriesCycle.sessionIdAfter,
    report.recordings.interactive.digest,
    { verified: true, artifactVerified: true, contextCaptured: true },
  );
  exactFabricExecEvidence(
    fabricExecGate.resume,
    "resume",
    lifecycle.sessionId,
    report.recordings.resume.digest,
    { durableVerified: true, artifactUnavailable: true },
  );
  if (!Array.isArray(fabricExecGate.continuityContextSeeds) || fabricExecGate.continuityContextSeeds.length !== 3 ||
      !Array.isArray(fabricExecGate.continuityChecks) || fabricExecGate.continuityChecks.length !== 3 ||
      !SHA256.test(fabricExecGate.continuityChecksOutputDigest ?? "")) {
    fail("compaction-cycle fabric_exec integrity gate is incomplete");
  }
  const expectedContinuityChecks = [
    { kind: "manual", cycle: 2, beforeSessionId: compactionSeries.manual[1].sessionIdBefore, afterSessionId: compactionSeries.manual[1].sessionIdAfter },
    { kind: "manual", cycle: 3, beforeSessionId: compactionSeries.manual[2].sessionIdBefore, afterSessionId: compactionSeries.manual[2].sessionIdAfter },
    { kind: "automatic", cycle: 1, beforeSessionId: automaticCompactionGate.sessionIdBefore, afterSessionId: automaticCompactionGate.sessionIdAfter },
  ];
  const continuityContextSeedCalls = fabricExecGate.continuityContextSeeds.map((check, index) => {
    const expected = expectedContinuityChecks[index];
    if (check?.kind !== expected.kind || check.cycle !== expected.cycle) {
      fail(`compaction-cycle context-seed fabric_exec check ${index + 1} has the wrong identity`);
    }
    return exactFabricExecEvidence(
      check,
      `${expected.kind} compaction cycle ${expected.cycle} context-seed`,
      expected.beforeSessionId,
      report.recordings.interactive.digest,
      { verified: true },
    );
  });
  const continuityCalls = fabricExecGate.continuityChecks.map((check, index) => {
    const expected = expectedContinuityChecks[index];
    if (check?.kind !== expected.kind || check.cycle !== expected.cycle) {
      fail(`compaction-cycle fabric_exec check ${index + 1} has the wrong identity`);
    }
    return exactFabricExecEvidence(
      check,
      `${expected.kind} compaction cycle ${expected.cycle}`,
      expected.afterSessionId,
      report.recordings.interactive.digest,
      { verified: true, artifactVerified: true, contextCaptured: true },
    );
  });
  const allToolCallIds = [contextSeedCall, postCompactionCall, fabricExecGate.resume,
    ...continuityContextSeedCalls, ...continuityCalls]
    .map((call) => call.toolCallId);
  if (new Set(allToolCallIds).size !== allToolCallIds.length) fail("compaction qualification reused a fabric_exec tool-call identity");
  if (compactedFact.postCompactionToolCallId !== postCompactionCall.toolCallId ||
      compactedFact.postCompactionArgumentsDigest !== postCompactionCall.observedArgumentsDigest ||
      compactedFact.contextSeedToolCallId !== contextSeedCall.toolCallId ||
      postCompactionCall.observedContextFactDigest !== compactedFact.factDigest) {
    fail("compacted conversational fact is not bound to the post-compaction fabric_exec call");
  }
  for (const [index, call] of continuityCalls.entries()) {
    const fact = compactedFacts[index + 1];
    const seed = continuityContextSeedCalls[index];
    if (fact.postCompactionToolCallId !== call.toolCallId ||
        fact.postCompactionArgumentsDigest !== call.observedArgumentsDigest ||
        fact.contextSeedToolCallId !== seed.toolCallId ||
        call.observedContextFactDigest !== fact.factDigest) {
      fail(`compaction-series conversational fact ${index + 2} is not bound to its exact fabric_exec calls`);
    }
  }
  if (formGate.acpRecordingDigest !== report.recordings.formProbe.digest ||
      compactionGate.acpRecordingDigest !== report.recordings.interactive.digest ||
      compactionSeries.acpRecordingDigest !== report.recordings.interactive.digest ||
      continuityGate.interactiveRecordingDigest !== report.recordings.interactive.digest ||
      continuityGate.resumeRecordingDigest !== report.recordings.resume.digest ||
      continuityGate.sessionIdBeforeResume !== lifecycle.sessionId) fail("ACP qualification gates are not recording/session-bound");
  if (!report.workspace || typeof report.workspace.path !== "string" || !path.isAbsolute(report.workspace.path) ||
      report.workspace.finalDigest !== installation.workspaceBeforeDigest || report.workspace.forbiddenPathsAbsent !== true ||
      !SHA256.test(report.workspace.resolutionContextsBeforeDigest ?? "") ||
      report.workspace.resolutionContextsAfterDigest !== report.workspace.resolutionContextsBeforeDigest) fail("qualification workspace was mutated");
  verifyTranscript(report.transcript);
  const transcript = new Map(report.transcript.map((entry) => [entry.kind, entry]));
  const transcriptBytes = (kind) => Buffer.from(transcript.get(kind)?.raw ?? "", "base64");
  const transcriptText = (kind) => transcriptBytes(kind).toString("utf8");
  const terminalText = (kind) => transcriptText(kind)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replaceAll("\r", "\n");
  const hasToolToken = (text, tool) => new RegExp(`(?:^|[^a-z0-9_])${tool.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|[^a-z0-9_])`, "imu").test(text);
  const parseTraceEvent = (kind) => {
    let event;
    try { event = JSON.parse(transcriptText(kind)); }
    catch { fail(`${kind} is not a structural trace event`); }
    return event;
  };
  const requireTraceStart = (kind, expected) => {
    const event = parseTraceEvent(kind);
    if (event?.ev !== "agent.mcp.start" || event.data?.pid !== expected.pid || event.data?.parentPid !== expected.parentPid ||
        event.data?.mcpInstanceId !== expected.mcpInstanceId || event.data?.startedAt !== expected.startedAt) {
      fail(`${kind} is not bound to its lifecycle identity`);
    }
  };
  requireTraceStart("form-probe-mcp-startup", formIdentity);
  requireTraceStart("interactive-mcp-startup", interactiveIdentity);
  requireTraceStart("resume-mcp-startup", resumedIdentity);
  const formRequestEvent = parseTraceEvent("form-probe-trace-request");
  const formResponseEvent = parseTraceEvent("form-probe-trace-response");
  if (formRequestEvent?.ev !== "approval.form.request" || formResponseEvent?.ev !== "approval.form.response" ||
      formRequestEvent.data?.elicitationId !== formProbe.elicitationId || formResponseEvent.data?.elicitationId !== formProbe.elicitationId ||
      formResponseEvent.data?.action !== formProbe.responseAction || formResponseEvent.data?.approved !== false) {
    fail("form trace transcripts are not bound to the terminal response/lifecycle evidence");
  }
  const compactionEvent = parseTraceEvent("interactive-compaction-acp-event");
  if (compactionEvent?.method !== compactionGate.method || compactionEvent?.status !== compactionGate.status ||
      compactionEvent?.sessionId !== compactionGate.sessionId || compactionEvent?.frameDigest !== compactionGate.frameDigest ||
      compactionEvent?.intervalStartOffset !== compactionGate.intervalStartOffset ||
      compactionEvent?.intervalEndOffset !== compactionGate.intervalEndOffset ||
      !equal(compactionEvent?.manualExchange, compactionGate.manualExchange) ||
      transcript.get("interactive-compaction-acp-event")?.digest !== compactionGate.eventOutputDigest) {
    fail("structural ACP compaction transcript is not event-bound");
  }
  const compactionSeriesEvent = parseTraceEvent("interactive-compaction-series-acp-events");
  const seriesSummary = {
    manualCycleCount: compactionSeries.manualCycleCount,
    automaticCycleCount: compactionSeries.automaticCycleCount,
    manual: compactionSeries.manual,
    automatic: compactionSeries.automatic,
  };
  if (!equal(compactionSeriesEvent, seriesSummary) ||
      transcript.get("interactive-compaction-series-acp-events")?.digest !== compactionSeries.eventOutputDigest) {
    fail("repeated compaction series transcript is not structurally bound");
  }
  const contextSourceEvent = parseTraceEvent("interactive-context-source-acp-event");
  if (contextSourceEvent?.sessionId !== interactive.compaction.sessionIdBefore ||
      contextSourceEvent?.factDigest !== compactedFact.factDigest ||
      contextSourceEvent?.frameDigest !== compactedFact.preCompactionPromptFrameDigest ||
      transcript.get("interactive-context-source-acp-event")?.digest !== compactedFact.sourceOutputDigest) {
    fail("compacted conversational fact source is not transcript-bound");
  }
  const compactedFactsEvent = parseTraceEvent("interactive-compaction-cycle-context-sources");
  if (!equal(compactedFactsEvent, compactedFacts) ||
      transcript.get("interactive-compaction-cycle-context-sources")?.digest !== continuityGate.compactedFactsOutputDigest) {
    fail("compaction-series conversational facts are not transcript-bound");
  }
  const exactCallTranscript = (kind, expected, label) => {
    const observed = parseTraceEvent(kind);
    const { acpRecordingDigest: _recordingDigest, outputDigest, ...summary } = expected;
    if (valueDigest(observed) !== valueDigest(summary) || transcript.get(kind)?.digest !== outputDigest) {
      fail(`${label} fabric_exec evidence is not transcript-bound`);
    }
  };
  exactCallTranscript("interactive-context-seed-acp-call", contextSeedCall, "context-seed");
  exactCallTranscript("interactive-post-compaction-acp-call", postCompactionCall, "post-compaction");
  exactCallTranscript("resume-acp-call", fabricExecGate.resume, "resume");
  const cycleCallTranscript = parseTraceEvent("interactive-compaction-cycle-acp-calls");
  const callSummaries = (calls) => calls.map((call) => {
    const { acpRecordingDigest: _recordingDigest, outputDigest: _outputDigest, ...summary } = call;
    return summary;
  });
  const expectedCycleCallTranscript = {
    contextSeeds: callSummaries(continuityContextSeedCalls),
    postCompactions: callSummaries(continuityCalls),
  };
  if (!equal(cycleCallTranscript, expectedCycleCallTranscript) ||
      transcript.get("interactive-compaction-cycle-acp-calls")?.digest !== fabricExecGate.continuityChecksOutputDigest ||
      [...continuityContextSeedCalls, ...continuityCalls]
        .some((call) => call.outputDigest !== fabricExecGate.continuityChecksOutputDigest)) {
    fail("compaction-cycle fabric_exec evidence is not transcript-bound");
  }
  if (transcriptText("kiro-version").trim().slice(0, 256) !== kiro.version ||
      !transcriptText("interactive-session-id").includes(interactive.compaction.sessionIdBefore) ||
      !transcriptText("interactive-post-compaction-session-id").includes(firstSeriesCycle.sessionIdAfter) ||
      !transcriptText("interactive-manual-compaction-2-session-id").includes(compactionSeries.manual[1].sessionIdAfter) ||
      !transcriptText("interactive-manual-compaction-3-session-id").includes(compactionSeries.manual[2].sessionIdAfter) ||
      !transcriptText("interactive-automatic-compaction-session-id").includes(automaticCompactionGate.sessionIdAfter) ||
      !transcriptText("resume-session-id").includes(lifecycle.sessionId)) {
    fail("version/session transcripts are not lifecycle-bound");
  }
  const toolsText = terminalText("interactive-tools");
  if (![...REAL_CLIENT_NATIVE_TOOLS, ...REAL_CLIENT_TOOLS, "@fabric"].every((tool) => hasToolToken(toolsText, tool))) {
    fail("native/Fabric tool evidence is absent from the bound TUI transcript");
  }
  const formRequestText = terminalText("form-probe-request");
  if (!/Approve once/iu.test(formRequestText) || !/Risk:\s*write/iu.test(formRequestText)) {
    fail("form prompt evidence is absent from the bound TUI transcript");
  }
  for (const [index, kind] of [
    "interactive-compaction",
    "interactive-manual-compaction-2",
    "interactive-manual-compaction-3",
  ].entries()) {
    const compactText = terminalText(kind);
    if (/(?:compaction\s+failed|failed\s+to\s+compact|error\s+(?:during|while)\s+compact|unable\s+to\s+compact|compaction\s+cancelled)/iu.test(compactText) ||
        !/(?:compaction\s+(?:complete|completed|successful)|compacted|context\s+(?:was\s+)?summari[sz]ed)/iu.test(compactText)) {
      fail(`successful manual compaction cycle ${index + 1} is absent from the bound TUI transcript`);
    }
  }
  const automaticPressure = parseTraceEvent("interactive-automatic-compaction-pressure");
  if (!Array.isArray(automaticPressure?.attempts) || automaticPressure.attempts.length !== automaticCompactionGate.pressureTurns ||
      !equal(automaticPressure.event, automaticCompactionGate) ||
      automaticPressure.attempts.some((attempt, index) => attempt?.index !== index + 1 ||
        !Number.isSafeInteger(attempt.promptChars) || attempt.promptChars < REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS ||
        attempt.promptChars > REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS + 512 ||
        !SHA256.test(attempt.pressureMarkerDigest ?? "") || !Number.isSafeInteger(attempt.terminalBytes) ||
        attempt.terminalBytes < 1 || !SHA256.test(attempt.terminalDigest ?? "")) ||
      new Set(automaticPressure.attempts.map((attempt) => attempt.pressureMarkerDigest)).size !== automaticPressure.attempts.length ||
      automaticPressure.attempts.at(-1)?.pressureMarkerDigest !== automaticCompactionGate.pressureMarkerDigest ||
      automaticPressure.attempts.reduce((total, attempt) => total + attempt.promptChars, 0) !== automaticCompactionGate.totalPressureChars ||
      transcript.get("interactive-automatic-compaction-pressure")?.digest !== compactionSeries.automaticPressureOutputDigest) {
    fail("natural automatic compaction pressure evidence is not transcript-bound");
  }
  let recordedInheritance;
  let recordedAutoCompaction;
  let recordedAutoCompactionAfter;
  try {
    recordedInheritance = JSON.parse(transcriptText("resource-inheritance-setting"));
    recordedAutoCompaction = JSON.parse(transcriptText("automatic-compaction-setting"));
    recordedAutoCompactionAfter = JSON.parse(transcriptText("automatic-compaction-setting-final"));
  } catch { fail("Kiro settings transcripts are not structural JSON"); }
  if (recordedInheritance !== report.resources.disableInheritingDefaultResources ||
      recordedAutoCompaction !== report.resources.disableAutoCompaction ||
      recordedAutoCompactionAfter !== report.resources.disableAutoCompactionAfter) {
    fail("Kiro settings are not transcript-bound");
  }
  if (transcript.get("interactive-tools")?.digest !== nativeVisibility.outputDigest ||
      transcript.get("form-probe-request")?.digest !== formGate.requestOutputDigest ||
      transcript.get("form-probe-response")?.digest !== formGate.responseOutputDigest ||
      transcript.get("interactive-tools")?.bytes < 1 || transcript.get("form-probe-request")?.bytes < 1 ||
      transcript.get("form-probe-response")?.bytes < 1 || transcript.get("interactive-compaction-acp-event")?.bytes < 1 ||
      ["interactive-post-manual-compaction-2", "interactive-post-manual-compaction-3", "interactive-post-automatic-compaction"]
        .some((kind) => (transcript.get(kind)?.bytes ?? 0) < 1)) {
    fail("qualification gate output is not transcript-bound");
  }
  return report;
};
