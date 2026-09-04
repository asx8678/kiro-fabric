import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";
import {
  assertRealClientEvidence as assertRealClientEvidenceRaw,
  REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES,
  REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS,
  REAL_CLIENT_MANUAL_COMPACTION_CYCLES,
  REAL_CLIENT_NATIVE_TOOLS,
  REAL_CLIENT_PROFILE_TOOLS,
  REAL_CLIENT_TRANSCRIPT_KINDS,
  REAL_CLIENT_TOOLS,
  transcriptEntry,
} from "../scripts/real-client-evidence.mjs";
import {
  acpFormInteractionObserved,
  acpPriorUserMessageObserved,
  acpSessionLoadObserved,
  acpUserPromptFacts,
  completedAcpCompactionNotifications,
  completedAcpAutomaticCompactions,
  completedAcpManualCompactions,
  completedAcpFabricExecCalls,
  acpToolDataContaining,
  parseAcpJsonlFrames,
  postCompactionVerificationCode,
  qualificationValueDigest,
  resumeVerificationCode,
  sentinelVerificationCode,
} from "../scripts/run-kiro-agent-real-driver.mjs";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const digest = "a".repeat(64);
const archiveDigest = "b".repeat(64);
const commit = "c".repeat(40);
const workspaceDigest = "d".repeat(64);
const executable = "/opt/kiro/kiro-cli";
const runtimeDigest = "2".repeat(64);
const skillDigest = "3".repeat(64);
const installExecutable = "/usr/bin/node";
const kiroHome = "/private/kiro-home";
const installRoot = `${kiroHome}/kiro-fabric`;
const installedRuntime = `${installRoot}/runtime/${digest}`;
const installedData = `${installRoot}/data`;
const installedSkill = `${installRoot}/skills/fabric-exec/SKILL.md`;
const profileDigest = createHash("sha256").update(`${JSON.stringify(generateAgentProfile({
  nodePath: installExecutable,
  runtimeRoot: installedRuntime,
  dataRoot: installedData,
  skillPath: installedSkill,
}), null, 2)}\n`).digest("hex");
const assertRealClientEvidence = (report: unknown, packageDigest: string, options: Record<string, unknown> = {}) =>
  assertRealClientEvidenceRaw(report, packageDigest, { runtimeDigest, skillDigest, ...options });
const identity = (pid: number, parentPid: number, suffix: string) => ({
  pid,
  parentPid,
  mcpInstanceId: `fmcp_${suffix.repeat(32)}`,
  startedAt: "2026-09-03T10:00:00.000Z",
  runtimeGeneration: 1,
});
const interactiveIdentity = identity(200, 101, "1");
const headlessIdentity = identity(210, 100, "2");
const resumedIdentity = identity(220, 102, "3");
const formIdentity = identity(230, 103, "4");
const turn = (name: string) => ({ name, mcp: interactiveIdentity, fabricInfoCalls: 1, fabricExecCalls: 1, execSucceeded: true });
const sessionId = "12345678-1234-4123-8123-123456789abc";
const compactionFrameDigest = "1".repeat(64);
const compactionAcpEvent = {
  method: "_kiro.dev/compaction/status",
  status: "completed",
  sessionId,
  frameDigest: compactionFrameDigest,
};
const manualExchange = {
  sessionId,
  command: "/compact",
  requestIdDigest: "a".repeat(64),
  requestFrameDigest: "b".repeat(64),
  startedFrameDigest: "c".repeat(64),
  completedFrameDigest: compactionFrameDigest,
  responseFrameDigest: "d".repeat(64),
  responseResultDigest: "e".repeat(64),
  responseSuccess: true,
};
const compactionSummary = { ...compactionAcpEvent, intervalStartOffset: 10, intervalEndOffset: 20, manualExchange };
const seriesManualCycle = (index: number, start: number, end: number, frame: string) => ({
  index,
  command: "/compact",
  eventCount: 1,
  method: "_kiro.dev/compaction/status",
  status: "completed",
  sessionId,
  frameDigest: frame,
  intervalStartOffset: start,
  intervalEndOffset: end,
  manualExchange: index === 1 ? manualExchange : {
    sessionId,
    command: "/compact",
    requestIdDigest: `${index}`.repeat(64),
    requestFrameDigest: `${index + 1}`.repeat(64),
    startedFrameDigest: `${index + 2}`.repeat(64),
    completedFrameDigest: frame,
    responseFrameDigest: `${index + 3}`.repeat(64),
    responseResultDigest: `${index + 4}`.repeat(64),
    responseSuccess: true,
  },
  sessionIdBefore: sessionId,
  sessionIdAfter: sessionId,
  sessionIdChanged: false,
});
const manualCompactionSeries = [
  seriesManualCycle(1, 10, 20, compactionFrameDigest),
  seriesManualCycle(2, 30, 40, "2".repeat(64)),
  seriesManualCycle(3, 50, 60, "3".repeat(64)),
];
const automaticCompaction = {
  trigger: "natural-context-pressure",
  eventCount: 1,
  method: "_kiro.dev/compaction/status",
  status: "completed",
  sessionId,
  frameDigest: "8".repeat(64),
  intervalStartOffset: 70,
  intervalEndOffset: 80,
  sessionIdBefore: sessionId,
  sessionIdAfter: sessionId,
  sessionIdChanged: false,
  pressureTurns: 1,
  totalPressureChars: REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS + 128,
  pressureMarkerDigest: "9".repeat(64),
  promptRequestIdDigest: "a".repeat(64),
  promptFrameDigest: "b".repeat(64),
  startedFrameDigest: "c".repeat(64),
  completedFrameDigest: "8".repeat(64),
  manualCommandAbsent: true,
  toolCallsAbsent: true,
  settingMutated: false,
};
const compactionSeriesSummary = {
  manualCycleCount: REAL_CLIENT_MANUAL_COMPACTION_CYCLES,
  automaticCycleCount: REAL_CLIENT_AUTOMATIC_COMPACTION_CYCLES,
  manual: manualCompactionSeries,
  automatic: automaticCompaction,
};
const automaticPressureSummary = {
  attempts: [{
    index: 1,
    promptChars: REAL_CLIENT_AUTO_COMPACTION_PRESSURE_CHARS + 128,
    pressureMarkerDigest: automaticCompaction.pressureMarkerDigest,
    terminalBytes: 12,
    terminalDigest: "d".repeat(64),
  }],
  event: automaticCompaction,
};
const contextFactDigest = "4".repeat(64);
const contextSource = { sessionId, factDigest: contextFactDigest, frameDigest: "5".repeat(64) };
const postCompactionResult = { verified: true, artifactVerified: true, contextCaptured: true };
const resumeResult = { durableVerified: true, artifactUnavailable: true };
const postCompactionCall = {
  sessionId,
  toolCallId: "post-compaction-tool-call",
  expectedArgumentsDigest: "6".repeat(64),
  observedArgumentsDigest: "6".repeat(64),
  expectedResultDigest: qualificationValueDigest(postCompactionResult),
  observedResultDigest: qualificationValueDigest(postCompactionResult),
  observedContextFactDigest: contextFactDigest,
  frameDigests: ["7".repeat(64), "8".repeat(64)],
};
const contextSeedCall = {
  sessionId,
  toolCallId: "context-seed-tool-call",
  expectedArgumentsDigest: "e".repeat(64),
  observedArgumentsDigest: "e".repeat(64),
  expectedResultDigest: qualificationValueDigest({ verified: true }),
  observedResultDigest: qualificationValueDigest({ verified: true }),
  frameDigests: ["f".repeat(64)],
};
const resumeCall = {
  sessionId,
  toolCallId: "resume-tool-call",
  expectedArgumentsDigest: "9".repeat(64),
  observedArgumentsDigest: "9".repeat(64),
  expectedResultDigest: qualificationValueDigest(resumeResult),
  observedResultDigest: qualificationValueDigest(resumeResult),
  frameDigests: ["0".repeat(64)],
};
const cycleCall = (kind: "manual" | "automatic", cycle: number, suffix: string, factDigest: string) => ({
  kind,
  cycle,
  sessionId,
  toolCallId: `${kind}-compaction-${cycle}-tool-call`,
  expectedArgumentsDigest: suffix.repeat(64),
  observedArgumentsDigest: suffix.repeat(64),
  expectedResultDigest: qualificationValueDigest({ verified: true, artifactVerified: true, contextCaptured: true }),
  observedResultDigest: qualificationValueDigest({ verified: true, artifactVerified: true, contextCaptured: true }),
  observedContextFactDigest: factDigest,
  frameDigests: [`${suffix === "a" ? "b" : suffix === "b" ? "c" : "d"}`.repeat(64)],
});
const cycleSeedCall = (kind: "manual" | "automatic", cycle: number, suffix: string) => ({
  kind,
  cycle,
  sessionId,
  toolCallId: `${kind}-compaction-${cycle}-context-seed-tool-call`,
  expectedArgumentsDigest: suffix.repeat(64),
  observedArgumentsDigest: suffix.repeat(64),
  expectedResultDigest: qualificationValueDigest({ verified: true }),
  observedResultDigest: qualificationValueDigest({ verified: true }),
  frameDigests: [`${suffix === "d" ? "e" : suffix === "e" ? "f" : "0"}`.repeat(64)],
});
const cycleFactDigests = ["5".repeat(64), "6".repeat(64), "7".repeat(64)];
const compactionCycleCalls = [
  cycleCall("manual", 2, "a", cycleFactDigests[0]!),
  cycleCall("manual", 3, "b", cycleFactDigests[1]!),
  cycleCall("automatic", 1, "c", cycleFactDigests[2]!),
];
const compactionCycleContextSeeds = [
  cycleSeedCall("manual", 2, "d"),
  cycleSeedCall("manual", 3, "e"),
  cycleSeedCall("automatic", 1, "f"),
];
const compactedFacts = [
  {
    kind: "manual",
    cycle: 1,
    source: "kiro-acp-precompact-prompt-to-fabric-exec",
    observed: true,
    factDigest: contextFactDigest,
    preCompactionSessionId: sessionId,
    preCompactionPromptFrameDigest: contextSource.frameDigest,
    postCompactionToolCallId: postCompactionCall.toolCallId,
    postCompactionArgumentsDigest: postCompactionCall.observedArgumentsDigest,
    contextSeedToolCallId: contextSeedCall.toolCallId,
    factAbsentFromPreCompactionToolData: true,
    durableEffectObserved: true,
  },
  ...compactionCycleCalls.map((call, index) => ({
    kind: call.kind,
    cycle: call.cycle,
    source: "kiro-acp-precompact-prompt-to-fabric-exec",
    observed: true,
    factDigest: cycleFactDigests[index]!,
    preCompactionSessionId: sessionId,
    preCompactionPromptFrameDigest: `${index + 6}`.repeat(64),
    postCompactionToolCallId: call.toolCallId,
    postCompactionArgumentsDigest: call.observedArgumentsDigest,
    contextSeedToolCallId: compactionCycleContextSeeds[index]!.toolCallId,
    factAbsentFromPreCompactionToolData: true,
    durableEffectObserved: true,
  })),
];
const compactionCycleCallSummary = {
  contextSeeds: compactionCycleContextSeeds,
  postCompactions: compactionCycleCalls,
};
const startup = (value: typeof interactiveIdentity): string => JSON.stringify({ ev: "agent.mcp.start", data: value });
const transcriptPayload = (kind: string, index: number): string => {
  if (kind === "kiro-version") return "kiro-cli 2.21.0";
  if (kind === "form-probe-mcp-startup") return startup(formIdentity);
  if (kind === "form-probe-trace-request") return JSON.stringify({ ev: "approval.form.request", data: { elicitationId: `form_${"4".repeat(16)}` } });
  if (kind === "form-probe-trace-response") return JSON.stringify({ ev: "approval.form.response", data: { elicitationId: `form_${"4".repeat(16)}`, action: "decline", approved: false } });
  if (kind === "interactive-mcp-startup") return startup(interactiveIdentity);
  if (kind === "resume-mcp-startup") return startup(resumedIdentity);
  if (kind === "interactive-tools") return [...REAL_CLIENT_PROFILE_TOOLS, ...REAL_CLIENT_TOOLS].join("\n");
  if (kind === "form-probe-request") return "Risk: write\nApprove once";
  if (kind === "resource-inheritance-setting" || kind === "automatic-compaction-setting" || kind === "automatic-compaction-setting-final") return "null";
  if (kind === "interactive-compaction") return "Compaction completed";
  if (kind === "interactive-compaction-acp-event") return `${JSON.stringify(compactionSummary)}\n`;
  if (kind === "interactive-compaction-series-acp-events") return `${JSON.stringify(compactionSeriesSummary)}\n`;
  if (kind === "interactive-context-source-acp-event") return `${JSON.stringify(contextSource)}\n`;
  if (kind === "interactive-context-seed-acp-call") return `${JSON.stringify(contextSeedCall)}\n`;
  if (kind === "interactive-post-compaction-acp-call") return `${JSON.stringify(postCompactionCall)}\n`;
  if (kind === "resume-acp-call") return `${JSON.stringify(resumeCall)}\n`;
  if (["interactive-session-id", "interactive-post-compaction-session-id", "interactive-manual-compaction-2-session-id",
    "interactive-manual-compaction-3-session-id", "interactive-automatic-compaction-session-id", "resume-session-id"].includes(kind)) return `Session ID: ${sessionId}`;
  if (["interactive-manual-compaction-2", "interactive-manual-compaction-3"].includes(kind)) return "Compaction completed";
  if (kind === "interactive-automatic-compaction-pressure") return `${JSON.stringify(automaticPressureSummary)}\n`;
  if (kind === "interactive-compaction-cycle-context-sources") return `${JSON.stringify(compactedFacts)}\n`;
  if (kind === "interactive-compaction-cycle-acp-calls") return `${JSON.stringify(compactionCycleCallSummary)}\n`;
  return `raw-${index}`;
};
const transcript = REAL_CLIENT_TRANSCRIPT_KINDS.map((kind, index) => transcriptEntry(kind, transcriptPayload(kind, index)));
const transcriptDigest = (kind: string) => transcript.find((entry) => entry.kind === kind)!.digest;

const valid = {
  kind: "kiro-fabric.real-client-qualification",
  schemaVersion: 10,
  ok: true,
  packageDigest: digest,
  archiveDigest,
  commit,
  tools: REAL_CLIENT_TOOLS,
  driver: { digest: "e".repeat(64), version: "repository-driver-v8" },
  kiro: { path: executable, digest: "f".repeat(64), version: "kiro-cli 2.21.0", headlessEngineSelector: "--agent-engine", agentValidateSyntax: "--path" },
  installation: {
    releaseRoot: "/private/release",
    kiroHome,
    profile: `${kiroHome}/agents/kiro-fabric.json`,
    runtime: installedRuntime,
    data: installedData,
    nodePath: installExecutable,
    packageDigest: digest,
    profileDigest,
    runtimeDigest,
    skillDigest,
    finalProfileDigest: profileDigest,
    finalRuntimeDigest: runtimeDigest,
    finalSkillDigest: skillDigest,
    workspaceBeforeDigest: workspaceDigest,
    workspaceAfterInstallDigest: workspaceDigest,
    workspaceProfileAbsent: true,
    releaseProfileAbsent: true,
  },
  qualificationGates: {
    nativeToolVisibility: {
      source: "kiro-tui-/tools",
      command: "/tools",
      observed: true,
      profileTools: REAL_CLIENT_PROFILE_TOOLS,
      nativeTools: REAL_CLIENT_NATIVE_TOOLS,
      fabricTools: REAL_CLIENT_TOOLS,
      outputDigest: transcriptDigest("interactive-tools"),
    },
    formElicitation: {
      source: "kiro-tui-form",
      observed: true,
      requestCount: 1,
      responseCount: 1,
      terminalPromptObserved: true,
      terminalResponseObserved: true,
      approved: false,
      failedClosed: true,
      acpStructuralEventObserved: true,
      acpRecordingDigest: "9".repeat(64),
      requestOutputDigest: transcriptDigest("form-probe-request"),
      responseOutputDigest: transcriptDigest("form-probe-response"),
    },
    compaction: {
      source: "kiro-acp-command-exchange",
      observed: true,
      eventCount: 1,
      method: compactionAcpEvent.method,
      status: compactionAcpEvent.status,
      sessionId: compactionAcpEvent.sessionId,
      frameDigest: compactionAcpEvent.frameDigest,
      acpRecordingDigest: "6".repeat(64),
      eventOutputDigest: transcriptDigest("interactive-compaction-acp-event"),
      intervalStartOffset: 10,
      intervalEndOffset: 20,
      manualExchange,
    },
    compactionSeries: {
      source: "kiro-acp-repeated-manual-and-natural-automatic",
      observed: true,
      acpRecordingDigest: "6".repeat(64),
      eventOutputDigest: transcriptDigest("interactive-compaction-series-acp-events"),
      automaticPressureOutputDigest: transcriptDigest("interactive-automatic-compaction-pressure"),
      ...compactionSeriesSummary,
    },
    conversationContinuity: {
      source: "kiro-acp-resume",
      observed: true,
      sessionIdBeforeResume: sessionId,
      sessionIdAfterResume: sessionId,
      acpSessionLoadObserved: true,
      acpOriginalUserMessageObserved: false,
      acpPriorUserMessageObserved: false,
      interactiveRecordingDigest: "6".repeat(64),
      resumeRecordingDigest: "7".repeat(64),
      compactedFact: {
        ...compactedFacts[0],
        sourceOutputDigest: transcriptDigest("interactive-context-source-acp-event"),
      },
      compactedFacts,
      compactedFactsOutputDigest: transcriptDigest("interactive-compaction-cycle-context-sources"),
    },
    fabricExecIntegrity: {
      source: "kiro-acp-session-tool-call",
      observed: true,
      contextSeed: {
        ...contextSeedCall,
        acpRecordingDigest: "6".repeat(64),
        outputDigest: transcriptDigest("interactive-context-seed-acp-call"),
      },
      postCompaction: {
        ...postCompactionCall,
        acpRecordingDigest: "6".repeat(64),
        outputDigest: transcriptDigest("interactive-post-compaction-acp-call"),
      },
      resume: {
        ...resumeCall,
        acpRecordingDigest: "7".repeat(64),
        outputDigest: transcriptDigest("resume-acp-call"),
      },
      continuityContextSeeds: compactionCycleContextSeeds.map((call) => ({
        ...call,
        acpRecordingDigest: "6".repeat(64),
        outputDigest: transcriptDigest("interactive-compaction-cycle-acp-calls"),
      })),
      continuityChecks: compactionCycleCalls.map((call) => ({
        ...call,
        acpRecordingDigest: "6".repeat(64),
        outputDigest: transcriptDigest("interactive-compaction-cycle-acp-calls"),
      })),
      continuityChecksOutputDigest: transcriptDigest("interactive-compaction-cycle-acp-calls"),
    },
  },
  commands: {
    install: { executable: installExecutable, resolvedExecutable: installExecutable, argv: ["/private/release/scripts/install-agent-user.mjs", "/private/release"] },
    version: { executable, argv: ["--version"] },
    helpAll: { executable, argv: ["--help-all"] },
    chatHelp: { executable, argv: ["chat", "--help"] },
    agentValidateHelp: { executable, argv: ["agent", "validate", "--help"] },
    validationContexts: ["/private/workspace", "/private/unrelated", "/private/unrelated/nested"].map((cwd) => ({
      cwd,
      validate: { executable, argv: ["agent", "validate", "--path", "/private/kiro-home/agents/kiro-fabric.json"] },
      list: { executable, argv: ["agent", "list"] },
    })),
    inheritance: { executable, argv: ["settings", "chat.disableInheritingDefaultResources", "--format", "json"] },
    autoCompaction: { executable, argv: ["settings", "chat.disableAutoCompaction", "--format", "json"] },
    autoCompactionFinal: { executable, argv: ["settings", "chat.disableAutoCompaction", "--format", "json"] },
    formProbe: { executable, argv: ["--v3", "--agent", "kiro-fabric"] },
    headless: { executable, argv: ["chat", "--agent-engine", "v3", "--agent", "kiro-fabric", "--no-interactive", "--require-mcp-startup", "--output-format", "stream-json", "prompt"] },
    interactive: { executable, argv: ["--v3", "--agent", "kiro-fabric"] },
    resume: { executable, argv: ["--v3", "--agent", "kiro-fabric", "--resume-id", sessionId] },
  },
  lifecycle: {
    sessionId,
    totalMcpStartupCount: 4,
    formProbe: {
      kiroPid: 103,
      mcp: formIdentity,
      startupCount: 1,
      requestCount: 1,
      responseCount: 1,
      elicitationId: `form_${"4".repeat(16)}`,
      responseAction: "decline",
      approved: false,
      execFailedClosed: true,
      clientCapabilities: { roots: true, formElicitation: true },
      observedDescendantPids: [],
      exited: true,
      noOrphan: true,
      traceDigest: "8".repeat(64),
    },
    headless: { kiroPid: 100, mcp: headlessIdentity, startupCount: 1, exited: true, noOrphan: true, traceDigest: "3".repeat(64) },
    interactive: {
      kiroPid: 101,
      mcp: interactiveIdentity,
      startupCount: 1,
      clientCapabilities: { roots: true, formElicitation: true },
      observedDescendantPids: [],
      turns: [
        turn("turn-1"),
        turn("turn-2"),
        turn("turn-3"),
        turn("post-compaction"),
        turn("manual-compaction-2-context-seed"),
        turn("post-manual-compaction-2"),
        turn("manual-compaction-3-context-seed"),
        turn("post-manual-compaction-3"),
        turn("automatic-compaction-context-seed"),
        turn("post-automatic-compaction"),
      ],
      compaction: {
        command: "/compact",
        completed: true,
        sessionIdBefore: sessionId,
        sessionIdAfter: sessionId,
        sessionIdChanged: false,
        mcp: interactiveIdentity,
      },
      manualCompactions: manualCompactionSeries.map((cycle) => ({
        index: cycle.index,
        command: "/compact",
        completed: true,
        sessionIdBefore: cycle.sessionIdBefore,
        sessionIdAfter: cycle.sessionIdAfter,
        sessionIdChanged: cycle.sessionIdChanged,
        mcp: interactiveIdentity,
      })),
      automaticCompaction: {
        trigger: "natural-context-pressure",
        completed: true,
        pressureTurns: automaticCompaction.pressureTurns,
        settingMutated: false,
        sessionIdBefore: automaticCompaction.sessionIdBefore,
        sessionIdAfter: automaticCompaction.sessionIdAfter,
        sessionIdChanged: automaticCompaction.sessionIdChanged,
        mcp: interactiveIdentity,
      },
      durableSentinels: { memory: true, state: true },
      ephemeralArtifact: { sameProcessReadable: true, removedAtShutdown: true },
      exited: true,
      noOrphan: true,
      traceDigest: "4".repeat(64),
    },
    resumed: {
      kiroPid: 102,
      mcp: resumedIdentity,
      startupCount: 1,
      sessionId,
      observedDescendantPids: [],
      durableMemoryRestored: true,
      durableStateRestored: true,
      ephemeralArtifactUnavailable: true,
      execSucceeded: true,
      exited: true,
      noOrphan: true,
      traceDigest: "5".repeat(64),
    },
  },
  recordings: {
    formProbe: { digest: "9".repeat(64), bytes: 100 },
    interactive: { digest: "6".repeat(64), bytes: 100 },
    resume: { digest: "7".repeat(64), bytes: 100 },
  },
  resources: {
    disableInheritingDefaultResources: null,
    defaultResourcesInherited: true,
    disableAutoCompaction: null,
    disableAutoCompactionAfter: null,
    autoCompactionEnabled: true,
    autoCompactionSettingMutated: false,
  },
  workspace: {
    path: "/private/workspace",
    finalDigest: workspaceDigest,
    forbiddenPathsAbsent: true,
    resolutionContextsBeforeDigest: "0".repeat(64),
    resolutionContextsAfterDigest: "0".repeat(64),
  },
  transcript,
};

describe("real-client release evidence", () => {
  it("type-checks nonce-bound same-process and resumed sentinel programs", () => {
    for (const code of [sentinelVerificationCode(false), sentinelVerificationCode(true), postCompactionVerificationCode, resumeVerificationCode]) {
      expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors).toEqual([]);
    }
  });

  it("recognizes only a completed Kiro ACP compaction notification for the active session", () => {
    const completedFrame = {
      direction: "server-to-client",
      message: {
        jsonrpc: "2.0",
        method: "_kiro.dev/compaction/status",
        params: { sessionId, status: { type: "completed" }, summary: "structured summary" },
      },
    };
    expect(completedAcpCompactionNotifications([completedFrame], [sessionId])).toEqual([{
      method: "_kiro.dev/compaction/status",
      status: "completed",
      sessionId,
      frameDigest: createHash("sha256").update(JSON.stringify(completedFrame)).digest("hex"),
    }]);
    expect(completedAcpCompactionNotifications([{
      method: "session/notification",
      params: { content: [{ type: "text", text: JSON.stringify(completedFrame.message) }] },
    }], [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications([{
      direction: "client-to-server",
      message: completedFrame.message,
    }], [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications([{
      direction: "server-to-client",
      message: { method: "session/notification", params: { embedded: completedFrame.message } },
    }], [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications([{
      ...completedFrame.message,
      id: 42,
    }], [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications([{
      ...completedFrame.message,
      params: { sessionId, status: { type: "started" } },
    }], [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications([completedFrame], ["87654321-4321-4321-8321-cba987654321"])).toEqual([]);
  });

  it("end-binds manual compaction evidence so a later completion cannot qualify", () => {
    const before = `${JSON.stringify({ direction: "client-to-server", message: { jsonrpc: "2.0", id: 1, method: "session/prompt" } })}\n`;
    const started = `${JSON.stringify({ direction: "server-to-client", message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "started" } } } })}\n`;
    const completed = `${JSON.stringify({ direction: "server-to-client", message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "completed" } } } })}\n`;
    const bytes = Buffer.from(`${before}${started}${completed}`);
    const start = Buffer.byteLength(before);
    const manualEnd = start + Buffer.byteLength(started);
    expect(completedAcpCompactionNotifications(parseAcpJsonlFrames(bytes, start, manualEnd), [sessionId])).toEqual([]);
    expect(completedAcpCompactionNotifications(parseAcpJsonlFrames(bytes, start), [sessionId])).toHaveLength(1);
    // Even an end offset inside the later frame drops that partial frame.
    expect(completedAcpCompactionNotifications(parseAcpJsonlFrames(bytes, start, manualEnd + 20), [sessionId])).toEqual([]);
  });

  it("requires a causally paired manual slash-command exchange for compaction", () => {
    const request = { direction: "client-to-server", message: { jsonrpc: "2.0", id: 40, method: "_kiro.dev/commands/execute", params: { sessionId, command: "/compact" } } };
    const started = { direction: "server-to-client", message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "started" } } } };
    const completed = { direction: "server-to-client", message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "completed" } } } };
    const response = { direction: "server-to-client", message: { jsonrpc: "2.0", id: 40, result: { success: true } } };
    expect(completedAcpManualCompactions([request, started, completed, response], sessionId)).toHaveLength(1);
    expect(completedAcpManualCompactions([started, completed], sessionId)).toEqual([]);
    expect(completedAcpManualCompactions([request, completed, response], sessionId)).toEqual([]);
    expect(completedAcpManualCompactions([started, request, completed, response], sessionId)).toEqual([]);
    expect(completedAcpManualCompactions([{ ...request, direction: "server-to-client" }, started, completed, response], sessionId)).toEqual([]);
    const wrongCommand = structuredClone(request);
    wrongCommand.message.params.command = "/clear";
    expect(completedAcpManualCompactions([wrongCommand, started, completed, response], sessionId)).toEqual([]);
    const failedResponse = structuredClone(response);
    failedResponse.message.result.success = false;
    expect(completedAcpManualCompactions([request, started, completed, failedResponse], sessionId)).toEqual([]);
    const wrongIdType = { ...structuredClone(response), message: { ...response.message, id: "40" } };
    expect(completedAcpManualCompactions([request, started, completed, wrongIdType], sessionId)).toEqual([]);
  });

  it("recognizes natural automatic compaction only after a direct pressure prompt with no manual command or tool call", () => {
    const marker = "kiro-auto-compact-0123456789abcdef";
    const prompt = {
      direction: "client-to-server",
      message: { jsonrpc: "2.0", id: 41, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: `pressure ${marker}` }] } },
    };
    const started = {
      direction: "server-to-client",
      message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "started" } } },
    };
    const completed = {
      direction: "server-to-client",
      message: { jsonrpc: "2.0", method: "_kiro.dev/compaction/status", params: { sessionId, status: { type: "completed" } } },
    };
    const matches = completedAcpAutomaticCompactions([prompt, started, completed], sessionId, marker);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      sessionId,
      trigger: "natural-context-pressure",
      manualCommandAbsent: true,
      toolCallsAbsent: true,
      pressureMarkerDigest: qualificationValueDigest(marker),
    });
    const manual = {
      direction: "client-to-server",
      message: { jsonrpc: "2.0", id: 42, method: "_kiro.dev/commands/execute", params: { sessionId, command: "/compact" } },
    };
    expect(completedAcpAutomaticCompactions([prompt, manual, started, completed], sessionId, marker)).toEqual([]);
    const tool = {
      direction: "server-to-client",
      message: { jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: "unexpected" } } },
    };
    expect(completedAcpAutomaticCompactions([prompt, tool, started, completed], sessionId, marker)).toEqual([]);
    expect(completedAcpAutomaticCompactions([{
      direction: "server-to-client",
      message: { jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(prompt) } } } },
    }, started, completed], sessionId, marker)).toEqual([]);
  });

  it("binds exact fabric_exec ACP input and normalized structural output", () => {
    const expectedArguments = {
      code: "return { verified: payloads.nonce === 'nonce-a' }",
      payloads: { nonce: "nonce-a", key: "state-a", contextFact: "context-fact-a" },
      resultFormat: "json",
    };
    const expectedResult = { verified: true, artifactVerified: true };
    const call = {
      direction: "server-to-client",
      message: {
        jsonrpc: "2.0",
        method: "session/notification",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            title: "@fabric/fabric_exec",
            status: "in_progress",
            rawInput: expectedArguments,
          },
        },
      },
    };
    const completion = {
      direction: "server-to-client",
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            rawOutput: { content: [{ type: "text", text: JSON.stringify(expectedResult) }] },
          },
        },
      },
    };
    const matches = completedAcpFabricExecCalls([call, completion], { sessionId, expectedArguments, expectedResult });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      sessionId,
      toolCallId: "call-1",
      expectedArgumentsDigest: qualificationValueDigest(expectedArguments),
      observedArgumentsDigest: qualificationValueDigest(expectedArguments),
      expectedResultDigest: qualificationValueDigest(expectedResult),
      observedResultDigest: qualificationValueDigest(expectedResult),
      observedContextFactDigest: qualificationValueDigest(expectedArguments.payloads.contextFact),
    });
    expect(acpToolDataContaining([call, completion], expectedArguments.payloads.contextFact)).toHaveLength(1);

    const mutatedInputs = [
      { ...expectedArguments, code: `${expectedArguments.code} ` },
      { ...expectedArguments, payloads: { ...expectedArguments.payloads, key: "state-b" } },
      { ...expectedArguments, payloads: { ...expectedArguments.payloads, nonce: "nonce-b" } },
      { ...expectedArguments, extra: true },
    ];
    for (const rawInput of mutatedInputs) {
      const changed = structuredClone(call);
      changed.message.params.update.rawInput = rawInput;
      expect(completedAcpFabricExecCalls([changed, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    }
    for (const rawOutput of [
      { content: [{ type: "text", text: JSON.stringify({ verified: false, artifactVerified: true }) }] },
      { content: [{ type: "text", text: JSON.stringify({ ...expectedResult, extra: true }) }] },
      { content: [{ type: "text", text: `prose ${JSON.stringify(expectedResult)}` }] },
      { isError: true, content: [{ type: "text", text: JSON.stringify(expectedResult) }] },
      { content: [{ type: "text", text: JSON.stringify(expectedResult) }, { type: "text", text: "duplicate" }] },
    ]) {
      const changed = structuredClone(completion);
      changed.message.params.update.rawOutput = rawOutput;
      expect(completedAcpFabricExecCalls([call, changed], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    }

    const embedded = { direction: "client-to-server", message: { jsonrpc: "2.0", id: 9, method: "session/prompt", params: { sessionId, content: [{ type: "text", text: JSON.stringify(call) }] } } };
    expect(completedAcpFabricExecCalls([embedded, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const otherTool = structuredClone(call);
    otherTool.message.params.update.title = "read";
    expect(completedAcpFabricExecCalls([otherTool, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const otherServerTitle = structuredClone(call);
    otherServerTitle.message.params.update.title = "@evil/fabric_exec";
    expect(completedAcpFabricExecCalls([otherServerTitle, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const otherServer = structuredClone(call);
    Object.assign(otherServer.message.params.update, { name: "evil/fabric_exec" });
    expect(completedAcpFabricExecCalls([otherServer, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const namedCall = structuredClone(call);
    Object.assign(namedCall.message.params.update, { name: "fabric_exec" });
    const contradictoryIdentity = structuredClone(completion);
    Object.assign(contradictoryIdentity.message.params.update, { toolName: "read" });
    expect(completedAcpFabricExecCalls([namedCall, contradictoryIdentity], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const contradictoryTitle = structuredClone(completion);
    Object.assign(contradictoryTitle.message.params.update, { title: "read" });
    expect(completedAcpFabricExecCalls([call, contradictoryTitle], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const failedUpdate = structuredClone(completion);
    failedUpdate.message.params.update.status = "failed";
    expect(completedAcpFabricExecCalls([call, failedUpdate, completion], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const conflicting: unknown = {
      ...structuredClone(completion),
      message: {
        ...completion.message,
        params: {
          ...completion.message.params,
          update: {
            ...completion.message.params.update,
            rawInput: { ...expectedArguments, code: "different" },
          },
        },
      },
    };
    expect(completedAcpFabricExecCalls([call, completion, conflicting], { sessionId, expectedArguments, expectedResult })).toEqual([]);
    const secondCall = structuredClone(call);
    const secondCompletion = structuredClone(completion);
    secondCall.message.params.update.toolCallId = "call-2";
    secondCompletion.message.params.update.toolCallId = "call-2";
    expect(completedAcpFabricExecCalls([call, completion, secondCall, secondCompletion], { sessionId, expectedArguments, expectedResult })).toHaveLength(2);
  });

  it("recognizes a conversational fact only in a direct client prompt envelope", () => {
    const fact = "context-0123456789abcdef0123456789abcdef";
    const prompt = { direction: "client-to-server", message: { jsonrpc: "2.0", id: 8, method: "session/prompt", params: { sessionId, content: [{ type: "text", text: `remember ${fact}` }] } } };
    expect(acpUserPromptFacts([prompt], sessionId, fact)).toHaveLength(1);
    expect(acpUserPromptFacts([{ direction: "server-to-client", message: { jsonrpc: "2.0", method: "session/notification", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(prompt) } } } } }], sessionId, fact)).toEqual([]);
    expect(acpToolDataContaining([{ direction: "server-to-client", message: { jsonrpc: "2.0", method: "session/notification", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: fact } } } } }], fact)).toEqual([]);
    expect(acpUserPromptFacts([prompt], "87654321-4321-4321-8321-cba987654321", fact)).toEqual([]);
  });

  it("does not accept model-prose for form, load, or prior-message ACP evidence", () => {
    const formRequest = { direction: "server-to-client", message: { jsonrpc: "2.0", id: 12, method: "session/request_permission", params: { sessionId, options: [] } } };
    const formResponse = { direction: "client-to-server", message: { jsonrpc: "2.0", id: 12, result: { outcome: "cancelled" } } };
    expect(acpFormInteractionObserved([formRequest, formResponse])).toBe(true);
    expect(acpFormInteractionObserved([formRequest, { ...formResponse, message: { ...formResponse.message, id: "12" } }])).toBe(false);
    const loadRequest = { direction: "client-to-server", message: { jsonrpc: "2.0", id: 13, method: "session/load", params: { sessionId } } };
    const loadResponse = { direction: "server-to-client", message: { jsonrpc: "2.0", id: 13, result: { sessionId } } };
    expect(acpSessionLoadObserved([loadRequest, loadResponse], sessionId)).toBe(true);
    expect(acpSessionLoadObserved([loadRequest, { ...loadResponse, message: { ...loadResponse.message, id: "13" } }], sessionId)).toBe(false);
    const prior = { direction: "server-to-client", message: { jsonrpc: "2.0", method: "session/notification", params: { sessionId, update: { sessionUpdate: "user_message", content: [{ type: "text", text: "history-secret" }] } } } };
    expect(acpPriorUserMessageObserved([prior], "history-secret")).toBe(true);

    const prose = { direction: "server-to-client", message: { jsonrpc: "2.0", method: "session/notification", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify({ formRequest, loadRequest, prior }) } } } } };
    expect(acpFormInteractionObserved([prose])).toBe(false);
    expect(acpSessionLoadObserved([prose], sessionId)).toBe(false);
    expect(acpPriorUserMessageObserved([prose], "history-secret")).toBe(false);
  });

  it("accepts only archive-installed, exact-command, lifecycle-bound qualification evidence", () => {
    expect(assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest, commit })).toBe(valid);
    for (const patch of [
      { packageDigest: "9".repeat(64) },
      { archiveDigest: "8".repeat(64) },
      { commit: "7".repeat(40) },
      { tools: ["fabric_exec"] },
      { kind: "other" },
      { schemaVersion: 9 },
      { ok: false },
      { customAgentSelected: true },
      { powerActivated: false },
    ]) expect(() => assertRealClientEvidence({ ...valid, ...patch }, digest, { qualification: true, archiveDigest, commit })).toThrow();
  });

  it("rejects command drift and broad headless trust", () => {
    expect(() => assertRealClientEvidence({ ...valid, commands: { ...valid.commands, interactive: { executable, argv: ["chat", "--v3"] } } }, digest, { archiveDigest, commit })).toThrow("interactive command");
    expect(() => assertRealClientEvidence({ ...valid, commands: { ...valid.commands, headless: { executable, argv: [...valid.commands.headless.argv.slice(0, -1), "--trust-all-tools", "prompt"] } } }, digest, { archiveDigest, commit })).toThrow("headless command");
    expect(() => assertRealClientEvidence({ ...valid, commands: { ...valid.commands, headless: { executable, argv: [...valid.commands.headless.argv, "extra"] } } }, digest, { archiveDigest, commit })).toThrow("headless command");
    expect(() => assertRealClientEvidence({ ...valid, commands: { ...valid.commands, resume: { executable: "/different/kiro-cli", argv: valid.commands.resume.argv } } }, digest, { archiveDigest, commit })).toThrow("resume command");
    const wrongValidation = structuredClone(valid);
    wrongValidation.commands.validationContexts[2]!.validate.argv = ["agent", "validate", wrongValidation.installation.profile];
    expect(() => assertRealClientEvidence(wrongValidation, digest, { archiveDigest, commit })).toThrow("validation context 2");
  });

  it("binds the exact global runtime and complete generated profile to the extracted package", () => {
    const invokedThroughDifferentNodePath = structuredClone(valid);
    invokedThroughDifferentNodePath.commands.install.executable = "/usr/local/bin/node";
    expect(assertRealClientEvidence(invokedThroughDifferentNodePath, digest, { qualification: true, archiveDigest, commit }))
      .toBe(invokedThroughDifferentNodePath);

    const wrongRuntimeDigest = structuredClone(valid);
    wrongRuntimeDigest.installation.runtimeDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(wrongRuntimeDigest, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("archive installation evidence");

    const wrongRuntimePath = structuredClone(valid);
    wrongRuntimePath.installation.runtime = `${installRoot}/runtime/${"9".repeat(64)}`;
    expect(() => assertRealClientEvidence(wrongRuntimePath, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("independent global Agent installation");

    const wrongSkillDigest = structuredClone(valid);
    wrongSkillDigest.installation.skillDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(wrongSkillDigest, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("archive installation evidence");
    expect(() => assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest, commit, skillDigest: undefined }))
      .toThrow("archive installation evidence");

    const wrongCanonicalNode = structuredClone(valid);
    wrongCanonicalNode.commands.install.resolvedExecutable = "/different/node";
    expect(() => assertRealClientEvidence(wrongCanonicalNode, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("archive installation command");

    for (const field of ["finalProfileDigest", "finalRuntimeDigest", "finalSkillDigest"] as const) {
      const changedAfterQualification = structuredClone(valid);
      changedAfterQualification.installation[field] = "0".repeat(64);
      expect(() => assertRealClientEvidence(changedAfterQualification, digest, { qualification: true, archiveDigest, commit }))
        .toThrow("archive installation evidence");
    }

    const partialProfile = structuredClone(valid);
    const driftedProfile = generateAgentProfile({
      nodePath: installExecutable,
      runtimeRoot: installedRuntime,
      dataRoot: installedData,
      skillPath: installedSkill,
    });
    driftedProfile.mcpServers.fabric.requestTimeout -= 1;
    partialProfile.installation.profileDigest = createHash("sha256")
      .update(`${JSON.stringify(driftedProfile, null, 2)}\n`).digest("hex");
    partialProfile.installation.finalProfileDigest = partialProfile.installation.profileDigest;
    expect(() => assertRealClientEvidence(partialProfile, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("complete generated Agent contract");

    const wrongProfileNode = structuredClone(valid);
    wrongProfileNode.installation.nodePath = "/different/node";
    wrongProfileNode.commands.install.resolvedExecutable = "/different/node";
    expect(() => assertRealClientEvidence(wrongProfileNode, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("complete generated Agent contract");

    const missingCanonicalNode = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingCanonicalNode.installation.nodePath;
    expect(() => assertRealClientEvidence(missingCanonicalNode, digest, { qualification: true, archiveDigest, commit }))
      .toThrow("archive installation evidence");
  });

  it("cannot qualify without objective native-tool and real-TUI form evidence", () => {
    const noNativeTools = structuredClone(valid);
    noNativeTools.qualificationGates.nativeToolVisibility.observed = false;
    expect(() => assertRealClientEvidence(noNativeTools, digest, { qualification: true, archiveDigest, commit })).toThrow("native tool visibility");

    const noForm = structuredClone(valid);
    noForm.qualificationGates.formElicitation.observed = false;
    expect(() => assertRealClientEvidence(noForm, digest, { qualification: true, archiveDigest, commit })).toThrow("form elicitation");

    const noFormAcp = structuredClone(valid);
    noFormAcp.qualificationGates.formElicitation.acpStructuralEventObserved = false;
    expect(() => assertRealClientEvidence(noFormAcp, digest, { qualification: true, archiveDigest, commit })).toThrow("form elicitation");

    const missingFormRecording = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingFormRecording.qualificationGates.formElicitation.acpRecordingDigest;
    expect(() => assertRealClientEvidence(missingFormRecording, digest, { qualification: true, archiveDigest, commit })).toThrow("form elicitation");

    const approvedForm = structuredClone(valid);
    approvedForm.lifecycle.formProbe.approved = true;
    expect(() => assertRealClientEvidence(approvedForm, digest, { qualification: true, archiveDigest, commit })).toThrow("form-probe lifecycle");

    const forgedOutput = structuredClone(valid);
    forgedOutput.qualificationGates.nativeToolVisibility.outputDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedOutput, digest, { qualification: true, archiveDigest, commit })).toThrow("transcript-bound");

    const erroredForm = structuredClone(valid);
    erroredForm.lifecycle.formProbe.responseAction = "error";
    expect(() => assertRealClientEvidence(erroredForm, digest, { qualification: true, archiveDigest, commit })).toThrow("form-probe lifecycle");

    const forgedFormRecording = structuredClone(valid);
    forgedFormRecording.qualificationGates.formElicitation.acpRecordingDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedFormRecording, digest, { qualification: true, archiveDigest, commit })).toThrow("recording/session-bound");
  });

  it("requires structural Kiro conversation continuity on resume", () => {
    const missingContinuity = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingContinuity.qualificationGates.conversationContinuity;
    expect(() => assertRealClientEvidence(missingContinuity, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const noContinuity = structuredClone(valid);
    noContinuity.qualificationGates.conversationContinuity.observed = false;
    expect(() => assertRealClientEvidence(noContinuity, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const modelOnly = structuredClone(valid);
    modelOnly.qualificationGates.conversationContinuity.acpSessionLoadObserved = false;
    modelOnly.qualificationGates.conversationContinuity.acpOriginalUserMessageObserved = false;
    modelOnly.qualificationGates.conversationContinuity.acpPriorUserMessageObserved = false;
    expect(() => assertRealClientEvidence(modelOnly, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const priorMessages = structuredClone(valid);
    priorMessages.qualificationGates.conversationContinuity.acpSessionLoadObserved = false;
    priorMessages.qualificationGates.conversationContinuity.acpOriginalUserMessageObserved = true;
    priorMessages.qualificationGates.conversationContinuity.acpPriorUserMessageObserved = true;
    expect(() => assertRealClientEvidence(priorMessages, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const wrongSession = structuredClone(valid);
    wrongSession.qualificationGates.conversationContinuity.sessionIdAfterResume = "87654321-4321-4321-8321-cba987654321";
    expect(() => assertRealClientEvidence(wrongSession, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const forgedRecording = structuredClone(valid);
    forgedRecording.qualificationGates.conversationContinuity.resumeRecordingDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedRecording, digest, { qualification: true, archiveDigest, commit })).toThrow("recording/session-bound");

    const noCompactedFact = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete noCompactedFact.qualificationGates.conversationContinuity.compactedFact;
    expect(() => assertRealClientEvidence(noCompactedFact, digest, { qualification: true, archiveDigest, commit })).toThrow("compacted conversational fact");

    for (const field of ["factDigest", "preCompactionPromptFrameDigest", "postCompactionArgumentsDigest", "sourceOutputDigest"] as const) {
      const forgedFact = structuredClone(valid);
      forgedFact.qualificationGates.conversationContinuity.compactedFact[field] = "f".repeat(64);
      expect(() => assertRealClientEvidence(forgedFact, digest, { qualification: true, archiveDigest, commit })).toThrow(/compacted conversational fact/u);
    }
    const noFactEffect = structuredClone(valid);
    noFactEffect.qualificationGates.conversationContinuity.compactedFact.durableEffectObserved = false;
    expect(() => assertRealClientEvidence(noFactEffect, digest, { qualification: true, archiveDigest, commit })).toThrow("compacted conversational fact");
  });

  it("requires exact ACP-bound post-compaction and resume fabric_exec evidence", () => {
    const missing = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missing.qualificationGates.fabricExecIntegrity;
    expect(() => assertRealClientEvidence(missing, digest, { qualification: true, archiveDigest, commit })).toThrow("fabric_exec integrity");

    for (const phase of ["postCompaction", "resume"] as const) {
      for (const field of ["observedArgumentsDigest", "observedResultDigest", "acpRecordingDigest", "outputDigest"] as const) {
        const changed = structuredClone(valid);
        changed.qualificationGates.fabricExecIntegrity[phase][field] = "f".repeat(64);
        expect(() => assertRealClientEvidence(changed, digest, { qualification: true, archiveDigest, commit })).toThrow(/fabric_exec/u);
      }
      const noFrames = structuredClone(valid);
      noFrames.qualificationGates.fabricExecIntegrity[phase].frameDigests = [];
      expect(() => assertRealClientEvidence(noFrames, digest, { qualification: true, archiveDigest, commit })).toThrow(/fabric_exec/u);
    }
    const wrongFactDigest = structuredClone(valid);
    wrongFactDigest.qualificationGates.fabricExecIntegrity.postCompaction.observedContextFactDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(wrongFactDigest, digest, { qualification: true, archiveDigest, commit })).toThrow("compacted conversational fact");
    const missingContextSeed = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingContextSeed.qualificationGates.fabricExecIntegrity.contextSeed;
    expect(() => assertRealClientEvidence(missingContextSeed, digest, { qualification: true, archiveDigest, commit })).toThrow("fabric_exec integrity");
    const reusedCall = structuredClone(valid);
    reusedCall.qualificationGates.fabricExecIntegrity.resume = {
      ...reusedCall.qualificationGates.fabricExecIntegrity.postCompaction,
      acpRecordingDigest: reusedCall.recordings.resume.digest,
      outputDigest: reusedCall.qualificationGates.fabricExecIntegrity.resume.outputDigest,
    };
    expect(() => assertRealClientEvidence(reusedCall, digest, { qualification: true, archiveDigest, commit })).toThrow("resume fabric_exec");

    const changedCycleCall = structuredClone(valid);
    changedCycleCall.qualificationGates.fabricExecIntegrity.continuityChecks[1]!.observedResultDigest = "f".repeat(64);
    expect(() => assertRealClientEvidence(changedCycleCall, digest, { qualification: true, archiveDigest, commit })).toThrow("fabric_exec");

    const reusedCycleCall = structuredClone(valid);
    reusedCycleCall.qualificationGates.fabricExecIntegrity.continuityChecks[2]!.toolCallId =
      reusedCycleCall.qualificationGates.fabricExecIntegrity.continuityChecks[1]!.toolCallId;
    expect(() => assertRealClientEvidence(reusedCycleCall, digest, { qualification: true, archiveDigest, commit })).toThrow("reused a fabric_exec");
  });

  it("requires a distinct conversation-only fact and exact seed/result binding for every later compaction cycle", () => {
    const missingFacts = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingFacts.qualificationGates.conversationContinuity.compactedFacts;
    expect(() => assertRealClientEvidence(missingFacts, digest, { qualification: true, archiveDigest, commit })).toThrow("compaction-series conversational fact");

    for (const index of [1, 2, 3]) {
      const leaked = structuredClone(valid);
      leaked.qualificationGates.conversationContinuity.compactedFacts[index]!.factAbsentFromPreCompactionToolData = false;
      expect(() => assertRealClientEvidence(leaked, digest, { qualification: true, archiveDigest, commit })).toThrow("compaction-series conversational fact");

      const notDurable = structuredClone(valid);
      notDurable.qualificationGates.conversationContinuity.compactedFacts[index]!.durableEffectObserved = false;
      expect(() => assertRealClientEvidence(notDurable, digest, { qualification: true, archiveDigest, commit })).toThrow("compaction-series conversational fact");

      const wrongFact = structuredClone(valid);
      wrongFact.qualificationGates.conversationContinuity.compactedFacts[index]!.factDigest = "0".repeat(64);
      expect(() => assertRealClientEvidence(wrongFact, digest, { qualification: true, archiveDigest, commit })).toThrow(/conversational fact/u);

      const wrongPostResult = structuredClone(valid);
      wrongPostResult.qualificationGates.fabricExecIntegrity.continuityChecks[index - 1]!.observedResultDigest = "0".repeat(64);
      expect(() => assertRealClientEvidence(wrongPostResult, digest, { qualification: true, archiveDigest, commit })).toThrow("fabric_exec");

      const wrongSeedArguments = structuredClone(valid);
      wrongSeedArguments.qualificationGates.fabricExecIntegrity.continuityContextSeeds[index - 1]!.observedArgumentsDigest = "0".repeat(64);
      expect(() => assertRealClientEvidence(wrongSeedArguments, digest, { qualification: true, archiveDigest, commit })).toThrow("fabric_exec");
    }

    const reusedFact = structuredClone(valid);
    reusedFact.qualificationGates.conversationContinuity.compactedFacts[2]!.factDigest =
      reusedFact.qualificationGates.conversationContinuity.compactedFacts[1]!.factDigest;
    expect(() => assertRealClientEvidence(reusedFact, digest, { qualification: true, archiveDigest, commit })).toThrow(/not unique/u);

    const reusedSeedCall = structuredClone(valid);
    reusedSeedCall.qualificationGates.fabricExecIntegrity.continuityContextSeeds[2]!.toolCallId =
      reusedSeedCall.qualificationGates.fabricExecIntegrity.continuityContextSeeds[1]!.toolCallId;
    expect(() => assertRealClientEvidence(reusedSeedCall, digest, { qualification: true, archiveDigest, commit })).toThrow("reused a fabric_exec");

    const forgedSources = structuredClone(valid);
    const sourcesIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("interactive-compaction-cycle-context-sources");
    forgedSources.transcript[sourcesIndex] = transcriptEntry(
      "interactive-compaction-cycle-context-sources",
      JSON.stringify(forgedSources.qualificationGates.conversationContinuity.compactedFacts.slice(0, 3)),
    );
    forgedSources.qualificationGates.conversationContinuity.compactedFactsOutputDigest = forgedSources.transcript[sourcesIndex]!.digest;
    expect(() => assertRealClientEvidence(forgedSources, digest, { qualification: true, archiveDigest, commit })).toThrow("transcript-bound");

    const changedSeedTurn = structuredClone(valid);
    changedSeedTurn.lifecycle.interactive.turns[4]!.mcp = { ...interactiveIdentity, runtimeGeneration: 2 };
    expect(() => assertRealClientEvidence(changedSeedTurn, digest, { qualification: true, archiveDigest, commit })).toThrow("manual-compaction-2-context-seed");
  });

  it("cannot qualify from terminal compaction prose without a bound completed ACP notification", () => {
    const missing = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missing.qualificationGates.compaction;
    expect(() => assertRealClientEvidence(missing, digest, { qualification: true, archiveDigest, commit })).toThrow("structural ACP compaction");

    for (const [field, value] of [
      ["observed", false],
      ["eventCount", 0],
      ["method", "session/notification"],
      ["status", "started"],
      ["sessionId", "87654321-4321-4321-8321-cba987654321"],
      ["frameDigest", "0".repeat(64)],
      ["intervalStartOffset", 0],
      ["intervalEndOffset", 10],
    ] as const) {
      const changed = structuredClone(valid);
      // @ts-expect-error mutation fixture deliberately assigns heterogeneous invalid evidence.
      changed.qualificationGates.compaction[field] = value;
      expect(() => assertRealClientEvidence(changed, digest, { qualification: true, archiveDigest, commit })).toThrow(/structural ACP compaction/u);
    }

    const forgedRecording = structuredClone(valid);
    forgedRecording.qualificationGates.compaction.acpRecordingDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedRecording, digest, { qualification: true, archiveDigest, commit })).toThrow("recording/session-bound");

    const proseOnly = structuredClone(valid);
    const eventIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("interactive-compaction-acp-event");
    proseOnly.transcript[eventIndex] = transcriptEntry("interactive-compaction-acp-event", "Compaction completed");
    proseOnly.qualificationGates.compaction.eventOutputDigest = proseOnly.transcript[eventIndex]!.digest;
    expect(() => assertRealClientEvidence(proseOnly, digest, { qualification: true, archiveDigest, commit })).toThrow("structural trace event");

    const forgedEvent = structuredClone(valid);
    forgedEvent.qualificationGates.compaction.eventOutputDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedEvent, digest, { qualification: true, archiveDigest, commit })).toThrow("event-bound");
  });

  it("requires three ordered manual cycles and one natural automatic cycle in the same recording", () => {
    const missing = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missing.qualificationGates.compactionSeries;
    expect(() => assertRealClientEvidence(missing, digest, { qualification: true, archiveDigest, commit })).toThrow("repeated compaction series");

    const fewerManual = structuredClone(valid);
    fewerManual.qualificationGates.compactionSeries.manual.pop();
    fewerManual.qualificationGates.compactionSeries.manualCycleCount = 2;
    expect(() => assertRealClientEvidence(fewerManual, digest, { qualification: true, archiveDigest, commit })).toThrow("repeated compaction series");

    const overlapping = structuredClone(valid);
    overlapping.qualificationGates.compactionSeries.manual[1]!.intervalStartOffset = 15;
    expect(() => assertRealClientEvidence(overlapping, digest, { qualification: true, archiveDigest, commit })).toThrow("manual compaction series cycle 2");

    for (const [field, value] of [
      ["manualCommandAbsent", false],
      ["toolCallsAbsent", false],
      ["settingMutated", true],
      ["trigger", "manual"],
    ] as const) {
      const forged = structuredClone(valid);
      // @ts-expect-error mutation fixture deliberately assigns heterogeneous invalid evidence.
      forged.qualificationGates.compactionSeries.automatic[field] = value;
      expect(() => assertRealClientEvidence(forged, digest, { qualification: true, archiveDigest, commit })).toThrow("natural automatic compaction");
    }

    const changedIdentity = structuredClone(valid);
    changedIdentity.lifecycle.interactive.automaticCompaction.mcp = { ...interactiveIdentity, runtimeGeneration: 2 };
    expect(() => assertRealClientEvidence(changedIdentity, digest, { qualification: true, archiveDigest, commit })).toThrow("automatic compaction");

    const changedPressureTranscript = structuredClone(valid);
    const pressureIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("interactive-automatic-compaction-pressure");
    changedPressureTranscript.transcript[pressureIndex] = transcriptEntry("interactive-automatic-compaction-pressure", JSON.stringify({ attempts: [], event: automaticCompaction }));
    changedPressureTranscript.qualificationGates.compactionSeries.automaticPressureOutputDigest = changedPressureTranscript.transcript[pressureIndex]!.digest;
    expect(() => assertRealClientEvidence(changedPressureTranscript, digest, { qualification: true, archiveDigest, commit })).toThrow("pressure evidence");

    const changedSeriesTranscript = structuredClone(valid);
    const seriesIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("interactive-compaction-series-acp-events");
    changedSeriesTranscript.transcript[seriesIndex] = transcriptEntry("interactive-compaction-series-acp-events", JSON.stringify({
      ...compactionSeriesSummary,
      manualCycleCount: 2,
    }));
    changedSeriesTranscript.qualificationGates.compactionSeries.eventOutputDigest = changedSeriesTranscript.transcript[seriesIndex]!.digest;
    expect(() => assertRealClientEvidence(changedSeriesTranscript, digest, { qualification: true, archiveDigest, commit })).toThrow("structurally bound");
  });

  it("requires exact top-level help argv", () => {
    const missing = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missing.commands.helpAll;
    expect(() => assertRealClientEvidence(missing, digest, { qualification: true, archiveDigest, commit })).toThrow("top-level help");
    const drifted = structuredClone(valid);
    drifted.commands.helpAll.argv = ["--help"];
    expect(() => assertRealClientEvidence(drifted, digest, { qualification: true, archiveDigest, commit })).toThrow("top-level help");

    const formDrift = structuredClone(valid);
    formDrift.commands.formProbe.argv = ["chat", "--v3", "--agent", "kiro-fabric"];
    expect(() => assertRealClientEvidence(formDrift, digest, { qualification: true, archiveDigest, commit })).toThrow("form probe");

    const autoCompactionDrift = structuredClone(valid);
    autoCompactionDrift.commands.autoCompaction.argv = ["settings", "chat.disableAutoCompaction"];
    expect(() => assertRealClientEvidence(autoCompactionDrift, digest, { qualification: true, archiveDigest, commit })).toThrow("automatic compaction");

    const finalAutoCompactionDrift = structuredClone(valid);
    finalAutoCompactionDrift.commands.autoCompactionFinal.argv = ["settings", "chat.disableAutoCompaction"];
    expect(() => assertRealClientEvidence(finalAutoCompactionDrift, digest, { qualification: true, archiveDigest, commit })).toThrow("final automatic compaction");

    const disabledAutoCompaction = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately assigns an invalid setting value.
    disabledAutoCompaction.resources.disableAutoCompaction = true;
    disabledAutoCompaction.resources.autoCompactionEnabled = false;
    expect(() => assertRealClientEvidence(disabledAutoCompaction, digest, { qualification: true, archiveDigest, commit })).toThrow("automatic-compaction setting");

    const mutatedAutoCompaction = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately assigns an invalid setting value.
    mutatedAutoCompaction.resources.disableAutoCompactionAfter = true;
    mutatedAutoCompaction.resources.autoCompactionSettingMutated = true;
    expect(() => assertRealClientEvidence(mutatedAutoCompaction, digest, { qualification: true, archiveDigest, commit })).toThrow("automatic-compaction setting");
  });

  it("rejects MCP/runtime identity changes across turns or compaction", () => {
    const extraStartup = structuredClone(valid);
    extraStartup.lifecycle.totalMcpStartupCount = 5;
    expect(() => assertRealClientEvidence(extraStartup, digest, { archiveDigest, commit })).toThrow("startup identity");

    const changedTurn = structuredClone(valid);
    changedTurn.lifecycle.interactive.turns[2]!.mcp = {
      ...changedTurn.lifecycle.interactive.turns[2]!.mcp,
      runtimeGeneration: 2,
    };
    expect(() => assertRealClientEvidence(changedTurn, digest, { archiveDigest, commit })).toThrow("turn-3");
    const changedCompact = structuredClone(valid);
    changedCompact.lifecycle.interactive.compaction.mcp = {
      ...changedCompact.lifecycle.interactive.compaction.mcp,
      mcpInstanceId: resumedIdentity.mcpInstanceId,
    };
    expect(() => assertRealClientEvidence(changedCompact, digest, { archiveDigest, commit })).toThrow("compaction");
  });

  it("requires unrelated validation contexts to remain unchanged", () => {
    const changed = structuredClone(valid);
    changed.workspace.resolutionContextsAfterDigest = "9".repeat(64);
    expect(() => assertRealClientEvidence(changed, digest, { qualification: true, archiveDigest, commit })).toThrow("qualification workspace");
  });

  it("requires a fresh MCP instance on resume and durable-only restoration", () => {
    const sameProcess = structuredClone(valid);
    sameProcess.lifecycle.resumed.mcp = structuredClone(interactiveIdentity);
    expect(() => assertRealClientEvidence(sameProcess, digest, { archiveDigest, commit })).toThrow("resumed lifecycle");
    const falseDurability = structuredClone(valid);
    falseDurability.lifecycle.resumed.ephemeralArtifactUnavailable = false;
    expect(() => assertRealClientEvidence(falseDurability, digest, { archiveDigest, commit })).toThrow("resumed lifecycle");

    const missingDescendants = structuredClone(valid);
    // @ts-expect-error mutation fixture deliberately removes mandatory evidence.
    delete missingDescendants.lifecycle.interactive.observedDescendantPids;
    expect(() => assertRealClientEvidence(missingDescendants, digest, { archiveDigest, commit })).toThrow("descendant process evidence");
  });

  it("recomputes transcript byte counts and hashes", () => {
    const altered = structuredClone(valid);
    altered.transcript[0]!.raw = Buffer.from("forged").toString("base64");
    expect(() => assertRealClientEvidence(altered, digest, { qualification: true, archiveDigest, commit })).toThrow("transcript digest");

    const forgedStart = structuredClone(valid);
    const startIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("interactive-mcp-startup");
    forgedStart.transcript[startIndex] = transcriptEntry("interactive-mcp-startup", startup(resumedIdentity));
    expect(() => assertRealClientEvidence(forgedStart, digest, { qualification: true, archiveDigest, commit })).toThrow("lifecycle identity");

    const forgedFormTrace = structuredClone(valid);
    const responseIndex = REAL_CLIENT_TRANSCRIPT_KINDS.indexOf("form-probe-trace-response");
    forgedFormTrace.transcript[responseIndex] = transcriptEntry("form-probe-trace-response", JSON.stringify({
      ev: "approval.form.response",
      data: { elicitationId: valid.lifecycle.formProbe.elicitationId, action: "error", approved: false },
    }));
    expect(() => assertRealClientEvidence(forgedFormTrace, digest, { qualification: true, archiveDigest, commit })).toThrow("form trace transcripts");
  });

  it("requires authoritative expected archive and commit identities", () => {
    expect(() => assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest })).toThrow("commit");
    expect(() => assertRealClientEvidence(valid, digest, { qualification: true, commit })).toThrow("archive digest");
  });
});
