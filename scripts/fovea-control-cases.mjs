// Development-only native control cases. No host gates, configuration or approvals are bypassed.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
export const RULE_FIXTURES = Object.freeze({
  '.fovea/rules.json': JSON.stringify({ fileRoutes: [{ id: 'probe-pages', re: '^custom/(.*)\\.page$', verbs: 'exports', pathPrefix: '/probe-approved' }] }),
  'custom/hello.page': 'export function GET() {}\n',
});
const hash = text => createHash('sha256').update(text).digest('hex');
const attempt = 'async function attempt(run: () => Promise<JsonValue>): Promise<JsonObject> { try { return {ok:true,value:await run()}; } catch(error) { return {ok:false,error:String(error)}; } }';
export function extraControlProgram(marker, phase) {
  if (!/^[a-z0-9-]{1,80}$/u.test(marker) || !['rules', 'modes'].includes(phase)) throw Error('Invalid extra control case');
  if (phase === 'rules') return `${attempt}
const before = await repo.anchors({limit:100});
const read = await local.read({path:".fovea/rules.json"});
const adoption = await attempt(() => repo.adoptRules({expectedSha256:read.sha256}));
const after = await repo.anchors({limit:100});
const staleSha256 = (read.sha256[0] === "0" ? "1" : "0") + read.sha256.slice(1);
const stale = await attempt(() => repo.adoptRules({expectedSha256:staleSha256}));
const reread = await local.read({path:".fovea/rules.json"});
return {marker:${JSON.stringify(marker)},phase:"rules",before,sha256:read.sha256,adoption,after,stale,afterStale:await repo.anchors({limit:100}),rereadSha256:reread.sha256,status:await repo.status()};`;
  return `${attempt}
const before = await repo.settings();
const rows: JsonObject[] = [];
const modes: Array<"enabled"|"hidden"|"disabled"> = ["enabled","hidden","disabled"];
for (const mode of modes) {
  const settings = await repo.settings();
  const configured = await attempt(() => repo.configure({scope:"session",expectedRevision:settings.revision,config:{...settings.config,sync:{...settings.config.sync,mode}}}));
  const focus = await repo.focus({query:"ControlSentinel",fresh:true,maxTokens:512});
  rows.push({mode,before:settings,configured,settings:await repo.settings(),navigation:focus.status,status:await repo.status()});
}
return {marker:${JSON.stringify(marker)},phase:"modes",before,rows};`;
}
export function summarizeExtraControl(run, intact) {
  const p = run?.completed ? run.packet : null;
  const automaticOff = status => status?.capabilities?.automatic === false && status?.capabilities?.hiddenDelivery === false && status?.capabilities?.continuation === false;
  const checks = run?.phase === 'rules' ? {
    exactReadHash: p?.sha256 === hash(RULE_FIXTURES['.fovea/rules.json']) && p?.rereadSha256 === p.sha256,
    exactAdoption: p?.adoption?.ok === true && p?.adoption?.value?.adopted === true && p?.adoption?.value?.sha256 === p.sha256 && p?.adoption?.value?.sourceMutation === false,
    anchorEffect: Boolean(p?.before && p?.after && !JSON.stringify(p.before).includes('/probe-approved/hello') && JSON.stringify(p.after).includes('/probe-approved/hello')),
    staleHashRejected: p?.stale?.ok === false && typeof p?.stale?.error === 'string' && p.stale.error.includes('Rule source changed; reread before adoption') && isDeepStrictEqual(p.after, p.afterStale),
    automaticOff: automaticOff(p?.status),
  } : {
    allModesConfigured: Boolean(p?.rows?.length === 3 && ['enabled', 'hidden', 'disabled'].every((mode, i) => {
      const row = p.rows[i];
      return row.mode === mode && row.configured?.ok === true && row.settings?.config?.sync?.mode === mode && isDeepStrictEqual(row.configured.value, row.settings);
    })),
    explicitNavigationAvailable: Boolean(p?.rows?.length === 3 && p.rows.every(r => r.navigation === 'ok')),
    automaticOff: Boolean(p?.rows?.length === 3 && p.rows.every(r => automaticOff(r.status))),
  };
  return { schemaVersion: 1, kind: 'kiro-fabric.native-extra-control-probe', case: run?.phase ?? 'unknown', qualified: false, automatic: false,
    diagnosticCompleted: intact === true && run?.completed === true, checks,
    effectsObserved: intact === true && Object.values(checks).every(Boolean), nativeUiPresentationQualified: false,
    approval: run?.hostBlocked ? 'host-blocked' : 'unqualified',
    remaining: ['genuine human accept/decline evidence', 'native UI delivery and session association'] };
}

// These are observations of matched native forms plus actual state, never proof
// of physical human identity or all H09/H10 obligations.
export function controlDecisionEvidence(run, interaction, requestedDecision) {
  const p = run?.completed ? run.packet : null;
  const unchanged = (a, b) => a !== undefined && b !== undefined && isDeepStrictEqual(a, b);
  const unavailable = r => r?.ok === false && r.error?.includes('Fovea result unavailable:');
  const expectedConfig = p?.settingsBefore?.config ? { ...p.settingsBefore.config, sync: { ...p.settingsBefore.config.sync, ackClean: true, mode: 'hidden' }, tools: { ...p.settingsBefore.config.tools, defaultBudget: 1024 } } : null;
  const effects = {
    configure: {
      accept: p?.configure?.ok === true && unchanged(p?.settingsConfigured?.config, expectedConfig) && p?.settingsConfigured?.scope === 'session' && p?.settingsConfigured?.config?.sync?.ackClean === true && p?.settingsConfigured?.config?.sync?.mode === 'hidden' && p?.settingsConfigured?.config?.tools?.defaultBudget === 1024 && unchanged(p?.configure?.value, p?.settingsConfigured),
      decline: p?.configure?.ok === false && unchanged(p?.settingsBefore, p?.settingsConfigured),
    },
    reset: { accept: p?.reset?.ok === true && p?.retainedBefore?.ok === true && unavailable(p?.resetReplay),
      decline: p?.reset?.ok === false && p?.retainedBefore?.ok === true && p?.resetReplay?.ok === true && unchanged(p?.retainedBefore?.value, p?.resetReplay?.value) },
    reload: { accept: p?.reload?.ok === true && p?.reload?.value?.restarted === true && p?.reloadReplayBefore?.ok === true && unavailable(p?.reloadReplay) && unchanged(p?.settingsBefore, p?.settingsReloaded) && p?.after?.engineStarts === p?.beforeReload?.engineStarts + 1,
      decline: p?.reload?.ok === false && p?.reloadReplayBefore?.ok === true && p?.reloadReplay?.ok === true && unchanged(p?.settingsConfigured, p?.settingsReloaded) && unchanged(p?.reloadReplayBefore?.value, p?.reloadReplay?.value) && p?.after?.engineStarts === p?.beforeReload?.engineStarts },
  };
  const actions = Object.entries(effects).map(([operation, outcomes]) => {
    const forms = (run?.formPairs ?? []).filter(f => f.operation === `repo.${operation}`);
    const expected = operation === 'configure' && p?.settingsBefore ? { scope: 'session', expectedRevision: p.settingsBefore.revision,
      config: expectedConfig } : {};
    const form = forms.length === 1 && reviewed(forms[0], expected, p?.before?.rootId) ? forms[0] : null;
    const accepted = form?.action === 'accept' && form?.approved === true && !form?.missingHandler;
    const declined = form?.action === 'decline' && !form?.missingHandler;
    return { operation, decision: accepted ? 'accept' : declined ? 'decline' : 'unobserved',
      effectVerified: Boolean(p && interaction === 'human-terminal' && ((accepted && outcomes.accept) || (declined && outcomes.decline))) };
  });
  return { interaction, requestedDecision: requestedDecision ?? null, actions,
    requestedDecisionObserved: ['accept', 'decline'].includes(requestedDecision) && actions.every(a => a.decision === requestedDecision && a.effectVerified),
    humanApprovalQualified: false };
}

// Provider binding may add only its normalized rootId. Never accept truncated
// reviews, unknown options or a form for a different revision/hash/configuration.
function reviewed(form, expected, rootId) {
  const args = form?.reviewedArguments;
  return args !== null && typeof args === 'object' && !Array.isArray(args) &&
    (!('rootId' in args) || (typeof rootId === 'string' && rootId.length > 0 && args.rootId === rootId)) &&
    isDeepStrictEqual(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'rootId')), expected);
}
export function extraDecisionEvidence(run, interaction, requestedDecision) {
  const p = run?.completed === true && run?.exactCall === true ? run.packet : null;
  const forms = run?.formPairs ?? [];
  const verified = summarizeExtraControl(run, true).checks;
  const equal = (a, b) => a !== undefined && b !== undefined && isDeepStrictEqual(a, b);
  const entries = run?.phase === 'rules' ? [
    { operation: 'adoptRules:exact', rootId: p?.status?.rootId, ref: 'repo.adoptRules', args: { expectedSha256: p?.sha256 },
      accept: verified.exactReadHash && verified.exactAdoption && verified.anchorEffect,
      decline: verified.exactReadHash && p?.adoption?.ok === false && equal(p?.before, p?.after) },
    { operation: 'adoptRules:stale', rootId: p?.status?.rootId, ref: 'repo.adoptRules', args: { expectedSha256: typeof p?.sha256 === 'string' ? (p.sha256[0] === '0' ? '1' : '0') + p.sha256.slice(1) : null },
      accept: verified.exactReadHash && verified.staleHashRejected,
      decline: verified.exactReadHash && p?.stale?.ok === false && equal(p?.after, p?.afterStale) },
  ] : ['enabled', 'hidden', 'disabled'].map((mode, i) => {
    const row = p?.rows?.length === 3 && p.rows[i]?.mode === mode ? p.rows[i] : null;
    const config = row?.before?.config ? { ...row.before.config, sync: { ...row.before.config.sync, mode } } : null;
    return { operation: 'configure:' + mode, rootId: row?.status?.rootId, ref: 'repo.configure', args: { scope: 'session', expectedRevision: row?.before?.revision, config },
      accept: row?.configured?.ok === true && row?.settings?.scope === 'session' && equal(config, row?.settings?.config) && equal(row?.configured?.value, row?.settings),
      decline: row?.configured?.ok === false && equal(row?.before, row?.settings) };
  });
  const actions = entries.map((entry, i) => {
    const form = forms.length === entries.length ? forms[i] : null;
    const matched = form?.operation === entry.ref && !form?.missingHandler && reviewed(form, entry.args, entry.rootId);
    const decision = matched && form.action === 'accept' && form.approved === true ? 'accept' : matched && form.action === 'decline' ? 'decline' : 'unobserved';
    return { operation: entry.operation, decision,
      effectVerified: Boolean(p && interaction === 'human-terminal' && verified.automaticOff && (decision === 'accept' ? entry.accept : decision === 'decline' && entry.decline)) };
  });
  return { interaction, requestedDecision: requestedDecision ?? null, actions,
    requestedDecisionObserved: ['accept', 'decline'].includes(requestedDecision) && actions.every(a => a.decision === requestedDecision && a.effectVerified),
    humanApprovalQualified: false };
}
