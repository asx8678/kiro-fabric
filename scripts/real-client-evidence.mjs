import { createHash } from "node:crypto";
import path from "node:path";
import { generateAgentProfile } from "./agent-profile.mjs";

export const REAL_CLIENT_INTERACTIVE_COMMAND = ["kiro-cli", "--v3", "--agent", "kiro-fabric"];
export const REAL_CLIENT_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
export const REAL_CLIENT_NATIVE_TOOLS = ["read", "write", "shell", "web", "subagent", "todo_list"];
export const REAL_CLIENT_PROFILE_TOOLS = [...REAL_CLIENT_NATIVE_TOOLS, "@fabric"];
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
  "interactive-session-id",
  "interactive-compaction",
  "interactive-compaction-acp-event",
  "interactive-post-compaction-session-id",
  "interactive-post-compaction",
  "interactive-shutdown",
  "resume-start",
  "resume-mcp-startup",
  "resume-session-id",
  "resume-turn",
  "resume-shutdown",
  "headless-selection",
];

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const MCP_INSTANCE_ID = /^fmcp_[a-f0-9]{32}$/u;
const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`invalid real-client evidence: ${message}`); };

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

export const assertRealClientEvidence = (report, packageDigest, options = {}) => {
  if (!report || typeof report !== "object") fail("report must be an object");
  if (options.qualification === true && (report.kind !== "kiro-fabric.real-client-qualification" || report.schemaVersion !== 7 || report.ok !== true)) fail("qualification identity is invalid");
  if (report.packageDigest !== packageDigest || !SHA256.test(report.packageDigest)) fail("package digest is invalid");
  if (!options.archiveDigest || report.archiveDigest !== options.archiveDigest || !SHA256.test(report.archiveDigest)) fail("archive digest is invalid");
  if (!options.commit || report.commit !== options.commit || !GIT_OBJECT_ID.test(report.commit)) fail("commit is invalid");
  if (Object.hasOwn(report, "powerActivated") || Object.hasOwn(report, "customAgentSelected")) fail("model self-attestation fields are forbidden");
  if (!equal(report.tools, REAL_CLIENT_TOOLS)) fail("Fabric tool surface is invalid");

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
  if (!SHA256.test(report.driver?.digest ?? "") || report.driver?.version !== "repository-driver-v5") fail("driver identity is invalid");

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
  if (!compactionGate || compactionGate.source !== "kiro-acp-server-notification" || compactionGate.observed !== true ||
      compactionGate.eventCount !== 1 || compactionGate.method !== "_kiro.dev/compaction/status" ||
      compactionGate.status !== "completed" || !SESSION_ID.test(compactionGate.sessionId ?? "") ||
      !SHA256.test(compactionGate.frameDigest ?? "") || !SHA256.test(compactionGate.acpRecordingDigest ?? "") ||
      !SHA256.test(compactionGate.eventOutputDigest ?? "")) {
    fail("structural ACP compaction gate is incomplete");
  }
  const continuityGate = gates?.conversationContinuity;
  if (!continuityGate || continuityGate.source !== "kiro-acp-resume" || continuityGate.observed !== true ||
      !SESSION_ID.test(continuityGate.sessionIdBeforeResume ?? "") || continuityGate.sessionIdBeforeResume !== continuityGate.sessionIdAfterResume ||
      (continuityGate.acpSessionLoadObserved !== true &&
        !(continuityGate.acpOriginalUserMessageObserved === true && continuityGate.acpPriorUserMessageObserved === true)) ||
      !SHA256.test(continuityGate.interactiveRecordingDigest ?? "") || !SHA256.test(continuityGate.resumeRecordingDigest ?? "")) {
    fail("conversation continuity gate is incomplete");
  }

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
      !Array.isArray(interactive.turns) || !equal(interactive.turns.map((turn) => turn.name), ["turn-1", "turn-2", "turn-3", "post-compaction"])) fail("interactive lifecycle is incomplete");
  for (const turn of interactive.turns) {
    if (!sameIdentity(identity(turn.mcp, `interactive ${turn.name}`), interactiveIdentity) || turn.fabricInfoCalls < 1 || turn.fabricExecCalls !== 1 || turn.execSucceeded !== true) fail(`interactive ${turn.name} did not preserve one Fabric runtime`);
  }
  if (interactive.compaction?.command !== "/compact" || interactive.compaction.completed !== true ||
      !SESSION_ID.test(interactive.compaction.sessionIdBefore ?? "") || interactive.compaction.sessionIdAfter !== lifecycle.sessionId ||
      interactive.compaction.sessionIdChanged !== (interactive.compaction.sessionIdBefore !== interactive.compaction.sessionIdAfter) ||
      !sameIdentity(identity(interactive.compaction.mcp, "compaction MCP"), interactiveIdentity)) fail("compaction lifecycle is incomplete");
  if (![interactive.compaction.sessionIdBefore, interactive.compaction.sessionIdAfter].includes(compactionGate.sessionId)) {
    fail("structural ACP compaction event is not session-bound");
  }
  if (interactive.durableSentinels?.memory !== true || interactive.durableSentinels?.state !== true || interactive.ephemeralArtifact?.sameProcessReadable !== true || interactive.ephemeralArtifact?.removedAtShutdown !== true) fail("interactive sentinel evidence is incomplete");

  const resumed = lifecycle.resumed;
  const resumedIdentity = identity(resumed?.mcp, "resumed MCP");
  descendantPids(resumed?.observedDescendantPids, "resumed");
  if (!Number.isSafeInteger(resumed?.kiroPid) || resumed.kiroPid <= 0 || resumedIdentity.parentPid !== resumed.kiroPid || resumed.sessionId !== lifecycle.sessionId || resumed.startupCount !== 1 || resumed.exited !== true || resumed.noOrphan !== true || !SHA256.test(resumed.traceDigest ?? "") ||
      resumedIdentity.pid === interactiveIdentity.pid || resumedIdentity.mcpInstanceId === interactiveIdentity.mcpInstanceId || resumedIdentity.runtimeGeneration !== 1 ||
      resumed.durableMemoryRestored !== true || resumed.durableStateRestored !== true || resumed.ephemeralArtifactUnavailable !== true || resumed.execSucceeded !== true) fail("resumed lifecycle is incomplete");
  if ([headlessIdentity.mcpInstanceId, interactiveIdentity.mcpInstanceId, resumedIdentity.mcpInstanceId, formIdentity.mcpInstanceId].some((value, index, values) => values.indexOf(value) !== index)) fail("separate Kiro processes reused an MCP instance identity");

  if (report.resources?.disableInheritingDefaultResources !== null && report.resources?.disableInheritingDefaultResources !== false || report.resources?.defaultResourcesInherited !== true) fail("effective default-resource inheritance was not recorded");
  for (const name of ["formProbe", "interactive", "resume"]) {
    const recording = report.recordings?.[name];
    if (!recording || !Number.isSafeInteger(recording.bytes) || recording.bytes < 1 || !SHA256.test(recording.digest ?? "")) fail(`${name} ACP recording identity is invalid`);
  }
  if (formGate.acpRecordingDigest !== report.recordings.formProbe.digest ||
      compactionGate.acpRecordingDigest !== report.recordings.interactive.digest ||
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
      transcript.get("interactive-compaction-acp-event")?.digest !== compactionGate.eventOutputDigest) {
    fail("structural ACP compaction transcript is not event-bound");
  }
  if (transcriptText("kiro-version").trim().slice(0, 256) !== kiro.version ||
      !transcriptText("interactive-session-id").includes(interactive.compaction.sessionIdBefore) ||
      !transcriptText("interactive-post-compaction-session-id").includes(lifecycle.sessionId) ||
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
  const compactText = terminalText("interactive-compaction");
  if (/(?:compaction\s+failed|failed\s+to\s+compact|error\s+(?:during|while)\s+compact|unable\s+to\s+compact|compaction\s+cancelled)/iu.test(compactText) ||
      !/(?:compaction\s+(?:complete|completed|successful)|compacted|context\s+(?:was\s+)?summari[sz]ed)/iu.test(compactText)) {
    fail("successful compaction is absent from the bound TUI transcript");
  }
  if (transcript.get("interactive-tools")?.digest !== nativeVisibility.outputDigest ||
      transcript.get("form-probe-request")?.digest !== formGate.requestOutputDigest ||
      transcript.get("form-probe-response")?.digest !== formGate.responseOutputDigest ||
      transcript.get("interactive-tools")?.bytes < 1 || transcript.get("form-probe-request")?.bytes < 1 ||
      transcript.get("form-probe-response")?.bytes < 1 || transcript.get("interactive-compaction-acp-event")?.bytes < 1) {
    fail("qualification gate output is not transcript-bound");
  }
  return report;
};
