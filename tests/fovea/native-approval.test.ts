import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { approvalProbeProfile, summarizeApprovalProbe } from '../../scripts/fovea-approval-probe.mjs';

const response = (id: unknown = 7, error = 'No handler registered for method: _kiro/mcp/elicitation') => ({ direction: 'client-to-server', message: { id, error: { code: -32601, message: error } } });
const request = (id: unknown = 7) => ({ direction: 'server-to-client', message: { id, method: '_kiro/mcp/elicitation', params: { requestedSchema: { type: 'object' } } } });
const call = (title = '@fabric/fabric_exec') => ({ direction: 'server-to-client', message: { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', title } } } });
const traces = [
  { ev: 'tool.fabric_exec' },
  { ev: 'approval.form.request', data: { elicitationId: 'form_1' } },
  { ev: 'approval.form.response', data: { elicitationId: 'form_1', action: 'error', approved: false, reason: 'missing_handler' } },
];
const result = { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed' };
const mode = (currentValue = 'fovea-native-approval-probe') => ({ direction: 'server-to-client', message: { result: { configOptions: [{ id: 'mode', currentValue }] } } });
const input = () => ({ frames: [mode(), call(), request(), response()], traces, result, before: 'before-native-approval\n', after: 'before-native-approval\n' });

describe('real native approval evidence', () => {
  it('requires native request/response identity and corresponding Fabric trace for a handler diagnosis', () => {
    const report = summarizeApprovalProbe(input());
    expect(report.approval.status).toBe('host-blocked');
    expect(report.approval.reason).toBe('native-form-handler-missing');
    expect(report.diagnosticCompleted).toBe(true);
    expect(report.fixture.unchanged).toBe(true);
    expect(report.qualified).toBe(false);
    expect(report.automatic).toBe(false);
  });
  it('rejects missing selected-mode evidence and final-mode fallback as completed diagnostics', () => {
    expect(summarizeApprovalProbe({ ...input(), frames: [call(), request(), response()] }).diagnosticCompleted).toBe(false);
    const report = summarizeApprovalProbe({ ...input(), frames: [...input().frames, mode('vibe')] });
    expect(report.selectedModeObserved).toBe(false);
    expect(report.diagnosticCompleted).toBe(false);
  });
  it('does not call a missing handler a user decline, approval or revocation', () => {
    expect(summarizeApprovalProbe(input()).approval).toMatchObject({ acceptedObserved: false, declinedObserved: false, revokedObserved: false, humanApprovalQualified: false });
  });
  it('does not infer the handler defect from generic errors or model prose', () => {
    const report = summarizeApprovalProbe({ ...input(), frames: [call(), request(), response(7, 'approval denied or unavailable'), { message: { content: 'No handler registered for method: _kiro/mcp/elicitation' } }] });
    expect(report.approval.status).toBe('unqualified');
  });
  it('rejects mismatched and differently typed native request IDs', () => {
    for (const id of [8, '7']) {
      const report = summarizeApprovalProbe({ ...input(), frames: [call(), request(), response(id)] });
      expect(report.approval.status).toBe('unqualified');
      expect(report.approval.nativeFormPairs).toHaveLength(0);
    }
  });
  it('rejects unrelated Fabric trace pairing', () => {
    const report = summarizeApprovalProbe({ ...input(), traces: [traces[0], traces[1], { ev: 'approval.form.response', data: { elicitationId: 'different', action: 'error', approved: false, reason: 'missing_handler' } }] });
    expect(report.approval.status).toBe('unqualified');
    expect(report.diagnosticCompleted).toBe(false);
  });
  it('requires an actual observed Fabric call, not a model-authored claim', () => {
    const report = summarizeApprovalProbe({ ...input(), frames: [request(), response()] });
    expect(report.actualFabricExecution).toBe(false);
    expect(report.diagnosticCompleted).toBe(false);
    expect(report.approval.status).toBe('unqualified');
  });
  it('never promotes partial call inventory to complete model-visible inventory', () => {
    const report = summarizeApprovalProbe({ ...input(), frames: [call(), call('disclose_context'), request(), response()] });
    expect(report.inventory).toMatchObject({ complete: false, extraClientToolObserved: true, tools: ['@fabric/fabric_exec', 'disclose_context'] });
  });
  it('marks unexpected file mutation and incomplete process cleanup as unsuccessful diagnostics', () => {
    expect(summarizeApprovalProbe({ ...input(), after: 'unexpected\n' }).diagnosticCompleted).toBe(false);
    expect(summarizeApprovalProbe({ ...input(), result: { ...result, stopReason: 'timeout' } }).diagnosticCompleted).toBe(false);
    expect(summarizeApprovalProbe({ ...input(), result: { ...result, cleanup: 'unconfirmed' } }).diagnosticCompleted).toBe(false);
  });
  it('reports accepted/declined protocol observations without manufacturing human qualification', () => {
    const accepted = { direction: 'client-to-server', message: { id: 7, result: { action: 'accept', content: { approved: true } } } };
    const report = summarizeApprovalProbe({ ...input(), frames: [call(), request(), accepted], interaction: 'human-terminal', after: 'after-native-approval\n' });
    expect(report.approval.acceptedObserved).toBe(true);
    expect(report.fixture.expectedEditObserved).toBe(true);
    expect(report.approval.humanApprovalQualified).toBe(false);
    expect(report.qualified).toBe(false);
  });
  it('uses real Fabric entry, isolated data and workspace, single tool and no automatic hooks', () => {
    const p = approvalProbeProfile({ runtimeRoot: '/runtime', nodePath: '/node', dataRoot: '/private/data', workspace: '/private/workspace' });
    expect(p.mcpServers.fabric.args).toEqual(['/runtime/kiro/mcp-entry.js']);
    expect(p.mcpServers.fabric.env.KIRO_FABRIC_DATA_ROOT).toBe('/private/data');
    expect(p.mcpServers.fabric.env.KIRO_FABRIC_LAUNCH_WORKSPACE).toBe('/private/workspace');
    expect(p.tools).toEqual(['@fabric/fabric_exec']);
    expect(p.includeMcpJson).toBe(false);
    expect(p.includePowers).toBe(false);
    expect(p.resources).toEqual([]);
    expect(p.hooks).toEqual([]);
  });
  it('reads the native 2.22.1 recorder and nested exact error even when MCP maps it to cancel', () => {
    const frames = [
      { dir: 'in', msg: call().message },
      { dir: 'in', msg: request().message },
      { dir: 'out', msg: { id: 7, error: { code: -32603, message: 'Internal error', data: { details: 'No handler registered for method: _kiro/mcp/elicitation' } } } },
    ];
    const cancelled = [traces[0], traces[1], { ev: 'approval.form.response', data: { elicitationId: 'form_1', action: 'cancel', approved: false } }];
    expect(summarizeApprovalProbe({ ...input(), frames, traces: cancelled }).approval).toMatchObject({ status: 'host-blocked', declinedObserved: false });
  });
  it('rejects model-authored native-looking messages without a recorder direction', () => {
    const frames = [{ msg: call().message }, { msg: request().message }, { msg: response().message }];
    expect(summarizeApprovalProbe({ ...input(), frames }).actualFabricExecution).toBe(false);
  });
  it('requires the real Fabric execution trace as well as a tool call title', () => {
    expect(summarizeApprovalProbe({ ...input(), traces: traces.slice(1) }).actualFabricExecution).toBe(false);
  });
  it('requires opt-in and rejects unsupported arguments without launching native Kiro', () => {
    for (const args of [[], ['--authenticated', '--approve-all']]) {
      const run = spawnSync(process.execPath, ['scripts/fovea-approval-probe.mjs', ...args], { encoding: 'utf8', timeout: 15000 });
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('explicit --authenticated required');
    }
  });
});
