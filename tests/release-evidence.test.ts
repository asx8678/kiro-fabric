import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";
import {
  assertRealClientEvidence as assertRealClientEvidenceRaw,
  REAL_CLIENT_NATIVE_TOOLS,
  REAL_CLIENT_PROFILE_TOOLS,
  REAL_CLIENT_TRANSCRIPT_KINDS,
  REAL_CLIENT_TOOLS,
  transcriptEntry,
} from "../scripts/real-client-evidence.mjs";
import {
  completedAcpCompactionNotifications,
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
  if (kind === "interactive-compaction") return "Compaction completed";
  if (kind === "interactive-compaction-acp-event") return `${JSON.stringify(compactionAcpEvent)}\n`;
  if (["interactive-session-id", "interactive-post-compaction-session-id", "resume-session-id"].includes(kind)) return `Session ID: ${sessionId}`;
  return `raw-${index}`;
};
const transcript = REAL_CLIENT_TRANSCRIPT_KINDS.map((kind, index) => transcriptEntry(kind, transcriptPayload(kind, index)));
const transcriptDigest = (kind: string) => transcript.find((entry) => entry.kind === kind)!.digest;

const valid = {
  kind: "kiro-fabric.real-client-qualification",
  schemaVersion: 7,
  ok: true,
  packageDigest: digest,
  archiveDigest,
  commit,
  tools: REAL_CLIENT_TOOLS,
  driver: { digest: "e".repeat(64), version: "repository-driver-v5" },
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
      source: "kiro-acp-server-notification",
      observed: true,
      eventCount: 1,
      method: compactionAcpEvent.method,
      status: compactionAcpEvent.status,
      sessionId: compactionAcpEvent.sessionId,
      frameDigest: compactionAcpEvent.frameDigest,
      acpRecordingDigest: "6".repeat(64),
      eventOutputDigest: transcriptDigest("interactive-compaction-acp-event"),
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
      turns: [turn("turn-1"), turn("turn-2"), turn("turn-3"), turn("post-compaction")],
      compaction: {
        command: "/compact",
        completed: true,
        sessionIdBefore: sessionId,
        sessionIdAfter: sessionId,
        sessionIdChanged: false,
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
  resources: { disableInheritingDefaultResources: null, defaultResourcesInherited: true },
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
    for (const code of [sentinelVerificationCode(false), sentinelVerificationCode(true), resumeVerificationCode]) {
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

  it("accepts only archive-installed, exact-command, lifecycle-bound qualification evidence", () => {
    expect(assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest, commit })).toBe(valid);
    for (const patch of [
      { packageDigest: "9".repeat(64) },
      { archiveDigest: "8".repeat(64) },
      { commit: "7".repeat(40) },
      { tools: ["fabric_exec"] },
      { kind: "other" },
      { schemaVersion: 6 },
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
    expect(assertRealClientEvidence(priorMessages, digest, { qualification: true, archiveDigest, commit })).toBe(priorMessages);

    const wrongSession = structuredClone(valid);
    wrongSession.qualificationGates.conversationContinuity.sessionIdAfterResume = "87654321-4321-4321-8321-cba987654321";
    expect(() => assertRealClientEvidence(wrongSession, digest, { qualification: true, archiveDigest, commit })).toThrow("conversation continuity");

    const forgedRecording = structuredClone(valid);
    forgedRecording.qualificationGates.conversationContinuity.resumeRecordingDigest = "0".repeat(64);
    expect(() => assertRealClientEvidence(forgedRecording, digest, { qualification: true, archiveDigest, commit })).toThrow("recording/session-bound");
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
