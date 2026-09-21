import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = (file: string) => readFileSync(new URL(`../../docs/fovea/${file}`, import.meta.url), 'utf8');
const read = (file: string) => JSON.parse(text(file));
type Gate = { id: string; requirement: string; status: string; surface: string; qualified: boolean; blocker: string | null; evidence: string[] };

describe('current Fovea qualification records', () => {
  it('keeps current H-gates consistent without transplanting old isolated auth failures', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.gates).toEqual(parity.hostGates);
    expect(qualification.gates.map((gate: Gate) => gate.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `H${String(index + 1).padStart(2, '0')}`),
    );
    expect(qualification.gates.every((gate: Gate) => gate.qualified === false)).toBe(true);
    expect(qualification.gates.every((gate: { blocker: string | null }) => gate.blocker !== 'isolated-auth-unavailable')).toBe(true);
    expect(qualification.historicalIsolatedHostGates.some((gate: { blocker: string | null }) => gate.blocker === 'isolated-auth-unavailable')).toBe(true);
    expect(qualification.qualified).toBe(false);
    expect(qualification.currentEvidence.releaseReady).toBe(false);
  });

  it('records native TUI observations without fabricating session routing or delivery', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.currentNativeProtocol).toEqual(parity.currentNativeProtocol);
    expect(qualification.currentNativeProtocol).toMatchObject({
      automatic: false, qualified: false, nativeSessionRouting: false,
      hiddenDelivery: false, actualModelInput: 'not-observed',
      tui: { hookSessionIdObserved: true, continuationMcpCallObserved: true },
      darwinProvenance: { implemented: true, pinnedLifecyclePassed: 15, pinnedLifecycleSkipped: 0 },
    });
  });

  it('distinguishes host blockers, partial mechanisms and untested complete contracts', () => {
    const gates: Gate[] = read('qualification.json').gates;
    expect(gates.map(gate => [gate.id, gate.status, gate.surface, gate.blocker])).toEqual([
      ['H01', 'host-blocked', 'headless-and-native-tui', 'native-session-rendezvous-unavailable'],
      ['H02', 'host-blocked', 'headless-and-native-tui', 'native-session-rendezvous-unavailable'],
      ['H03', 'partial', 'native-tui', 'native-session-rendezvous-unavailable'],
      ['H04', 'unqualified', 'native-tui', null],
      ['H05', 'partial', 'native-tui', null],
      ['H06', 'partial', 'native-tui', null],
      ['H07', 'partial', 'native-tui', null],
      ['H08', 'partial', 'headless-and-native-tui', null],
      ['H09', 'partial', 'headless', null],
      ['H10', 'host-blocked', 'native-tui', 'native-form-handler-missing'],
      ['H11', 'partial', 'headless-and-native-tui', null],
      ['H12', 'untested', 'headless', null],
    ]);
    for (const gate of gates) {
      if (gate.status !== 'untested') expect(gate.evidence.length).toBeGreaterThan(0);
    }
  });

  it('keeps the Markdown gate table aligned and the isolated auth table historical', () => {
    const gates: Gate[] = read('qualification.json').gates;
    const rows = text('parity-matrix.md').split('\n').filter(line => /^\| H\d{2} \|/.test(line));
    expect(rows).toHaveLength(gates.length);
    rows.forEach((row, index) => {
      const [, id, requirement, disposition] = row.split('|').map(cell => cell.trim());
      const gate = gates[index]!;
      expect([id, requirement, disposition?.split(':')[0]]).toEqual([gate.id, gate.requirement, gate.status]);
    });
    expect(text('host-capability-probes.md')).toContain('| Gate | Historical isolated headless status |');
    expect(text('host-capability-probes.md')).not.toContain('| Gate | Current headless status |');
    const historical = read('native-probe-report.json');
    expect(read('qualification.json').historicalIsolatedHostGates).toEqual(historical.gates);
  });

  it('retains fixture-only continuation bounds without qualifying the client contract', () => {
    const followup = read('qualification.json').currentNativeProtocol.followup;
    expect(followup.routing).toMatchObject({
      nativeSessionIdentityObserved: false, concurrentSessionMappingTested: false,
      initialTuiStartedInstances: 2, initialTuiInitializedInstances: 1,
    });
    expect(followup.stopContinuation).toMatchObject({
      surface: 'native-tui', mechanismDemonstrated: true, boundOwner: 'test-fixture',
      maxRequestsPerSession: 1, clientBoundQualified: false,
      report: '.tmp/fovea-native-VEArYZ/report.json',
      fixture: 'tests/fovea/fixtures/native-hook-probe.mjs',
    });
  });

  it('records resumed MCP instance turnover without claiming session association or new TUI hooks', () => {
    const qualification = read('qualification.json');
    const resume = qualification.currentNativeProtocol.followup.resume;
    const gate = qualification.gates.find((entry: Gate) => entry.id === 'H08');
    expect(gate).toMatchObject({ status: 'partial', surface: 'headless-and-native-tui', qualified: false, blocker: null });
    expect(resume).toMatchObject({
      surface: 'headless', sessionId: 'sess_f5aa7b83-c6dd-491f-98f9-1a0425304cb2',
      sessionIdentityPreserved: true, selectedModeObserved: true, fixtureMcpCallCompleted: true,
      mcp: {
        initialTuiInstance: 'fcab2cb8-07fb-4998-9d9b-f28bcc4624fc',
        resumedInstance: 'fe190816-e5a0-41d0-be62-72ec04eb943b', instanceChanged: true,
        clientInfo: { name: 'kiro', version: '0.0.0' },
        callParameterKeys: ['name', 'arguments'], callMeta: null,
        nativeSessionIdentityObserved: false, report: '.tmp/fovea-native-VEArYZ/mcp.jsonl',
      },
      tuiReplayIsHookEvidence: false, hookLifecycleEstablished: false,
      fabricStateRestorationEstablished: false, clearCompactProfileSwapTested: false,
      report: '.tmp/fovea-native-VEArYZ/resume-headless.jsonl',
    });
    expect(resume.mcp.resumedInstance).not.toBe(resume.mcp.initialTuiInstance);
    expect(gate.evidence).toEqual(expect.arrayContaining([resume.report, resume.mcp.report]));
    expect(gate.observation).toContain(resume.mcp.resumedInstance);
    expect(gate.observation).toContain(resume.mcp.initialTuiInstance);
    expect(gate.observation).toContain('replay, not new-hook evidence');
    expect(text('host-capability-probes.md')).toContain(resume.mcp.resumedInstance);
    expect(text('host-capability-probes.md')).toContain('replay, not new-hook evidence');
  });

  it('retains Escape-input evidence without claiming acknowledged cancellation or queued input', () => {
    const qualification = read('qualification.json');
    const cancellation = qualification.currentNativeProtocol.followup.cancellation;
    const gate = qualification.gates.find((entry: Gate) => entry.id === 'H07');
    expect(gate).toMatchObject({ status: 'partial', qualified: false, blocker: null });
    expect(gate.observation).toContain('cancelled response for prompt ID 3');
    expect(gate.observation).toContain('5517 ms after acknowledgment');
    expect(gate.remaining).toContain('stopping automatic hook/engine work');
    expect(text('host-capability-probes.md')).toContain('**cancellation/queue contract unverified**');
    expect(text('completion-ledger.md')).toContain('H07 is **unqualified**, not host-blocked');
    expect(cancellation).toMatchObject({
      surface: 'native-tui', status: 'unqualified',
      timeline: '.tmp/fovea-cancel-wgPbJV/timeline.jsonl',
      hookStartMs: 1789939858365, escapeSentMs: 1789939861063,
      nextUserSentMs: 1789939862213, hookEndMs: 1789939868368,
      completionAfterEscapeMs: 7305, loggedSignals: [],
      instrumentedSignals: ['SIGTERM', 'SIGINT', 'SIGHUP'],
      sessionCancelAcknowledgementObserved: false, secondUserPromptSubmitObserved: false,
      cancellationContractQualified: false, queuedInputPrecedenceQualified: false,
    });
    expect(cancellation.hookStartMs).toBeLessThan(cancellation.escapeSentMs);
    expect(cancellation.escapeSentMs).toBeLessThan(cancellation.nextUserSentMs);
    expect(cancellation.nextUserSentMs).toBeLessThan(cancellation.hookEndMs);
    expect(cancellation.hookEndMs - cancellation.escapeSentMs).toBe(cancellation.completionAfterEscapeMs);
  });

  it('records new native cancellation separately from the preserved Escape-only snapshot', () => {
    const current = read('qualification.json').currentNativeProtocol.acceptanceFollowup;
    expect(current).toMatchObject({ automatic: false, qualified: false,
      cancellation: { status: 'partial', turnCancellationAcknowledged: true, hookCancelNotificationObserved: true,
        hookCompletedAfterAcknowledgmentMs: 5517, queuedPromptAccepted: true, queuedTurnCompleted: true,
        oldHookCompletedAfterQueuedTurn: true, fullAutomaticCancellationContractQualified: false },
      sessionTransitions: { freshFixtureCalls: 4, driverExitCode: 0, actualFabricStateIsolationQualified: false },
      retainedGeneration: { tested: false } });
    expect(current.cancellation.hookCompletedAfterAcknowledgmentMs).toBeGreaterThan(current.cancellation.queuedPromptAfterCancelMs);
  });

  it('does not turn missing native approval handlers or observed tools into complete qualification', () => {
    const current = read('qualification.json').currentNativeProtocol.acceptanceFollowup;
    expect(current.approval).toMatchObject({ status: 'host-blocked', reason: 'native-form-handler-missing', actualFabricExecution: true,
      fixtureUnchanged: true, acceptedObserved: false, declinedObserved: false, revokedObserved: false, humanApprovalQualified: false });
    expect(current.inventory).toMatchObject({ complete: false, observedTools: ['@fabric/fabric_exec'], installedProfileUnchanged: true, installedProfileResourcesEnabled: 2 });
    expect(current.controls).toMatchObject({ actualFabricExecution: true, statusLazy: true, settingsDefaults: true, engineStartedOnce: true, sourceMatched: true, settingsMutationResetReloadQualified: false });
  });

  it('records observed Darwin explicit support separately from historical Linux counts', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.platformSourceFollowup).toEqual(parity.platformSource);
    expect(qualification.platformSourceFollowup.productionPlatforms).toContain('darwin-arm64');
    expect(qualification.platformSourceFollowup.darwinExecution).not.toContain('environment-blocked');
    expect(qualification.finalVerification.historical).toBe(true);
    expect(qualification.historicalLinuxPlatformSource.actualNativePlatform).toBe('linux');
  });
});
