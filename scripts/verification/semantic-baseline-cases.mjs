// Real Fovea engine semantic-baseline / receipt regression. OFFLINE, local
// development evidence only. NOT native qualification and NOT a claim about
// intended model-input delivery provenance. Every fixture is retained.

import assert from "node:assert/strict";
import path from "node:path";
import {
  inspectSemanticAdmission, semanticPrerequisite, createSemanticWorkspace, createPrivateDirectory,
  buildSemanticDriver, semanticIdentity, runSemanticScenario,
} from "./semantic-baseline-fixture.mjs";

export const requiredIds = ["FN01", "FN02", "FN03", "FN04", "FN05", "FN06", "FN07"];

const SOURCE = "export function alpha() { return 1; }\n";
const GAMMA = "export function gamma() { return 3; }\n";

// The supervised case deadline is a composed budget that must cover, in order:
// complete host-side generation admission plus the pre-spawn revalidation
// (VALIDATION), esbuild bundling of the engine entry and driver (BUILD), and the
// candidate Node cold start/execution (CHILD). These are allocation comments,
// not independently enforced stage bounds: runScenario retains its 120000ms
// child ceiling within the overall case deadline. AS02 detached engine settlement
// is unqualified. AS03 current JS / installed C is mixed-generation evidence.
// The overall deadline is not widened to the 900000ms harness ceiling.
const VALIDATION_BUDGET_MS = 60000;
const BUILD_BUDGET_MS = 90000;
const CHILD_BUDGET_MS = 30000;
const CASE_DEADLINE_MS = VALIDATION_BUDGET_MS + BUILD_BUDGET_MS + CHILD_BUDGET_MS;
const LONG_CASE_DEADLINE_MS = CASE_DEADLINE_MS + 60000;

const admission = await inspectSemanticAdmission();
const generation = admission.available ? admission.generation : undefined;
const prerequisite = generation ? undefined : semanticPrerequisite(admission.reason);

let counter = 0;
const nextId = () => `sem${String(++counter).padStart(3, "0")}`;

async function prepare(context) {
  const artifacts = await buildSemanticDriver(context, nextId());
  const identity = semanticIdentity(context, generation, artifacts);
  return { artifacts, identity };
}

function driverRequest(context, artifacts, generationRef, workspace, observed, scenario, extra = {}) {
  return {
    scenario,
    parser: generationRef.parser,
    engineEntry: artifacts.engineFile,
    storageRoot: createPrivateDirectory(context, `${scenario}-storage`),
    workspace,
    observed,
    deleted: extra.deleted,
    deleted2: extra.deleted2,
    dataRoot: extra.dataRoot,
    configFile: extra.configFile,
    conversationId: `conv_${nextId()}`,
    rootId: `root_${nextId()}`,
  };
}

function workspaceFiles(extra = {}) {
  return { "alpha.ts": SOURCE, ...(extra.gamma ? { "gamma.ts": GAMMA } : {}) };
}

function runScenario(context, artifacts, generationRef, workspace, observed, scenario, extra = {}) {
  const request = driverRequest(context, artifacts, generationRef, workspace, observed, scenario, extra);
  return runSemanticScenario(context, generationRef, artifacts, request, extra.timeoutMs ?? 120000);
}

function hostPaths(context) {
  const dataRoot = createPrivateDirectory(context, "host-data");
  const configDir = createPrivateDirectory(context, "host-config");
  return { dataRoot, configFile: path.join(configDir, "fovea.json") };
}

// ---------------------------------------------------------------------------

async function engineBaseline(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "baseline", workspaceFiles());
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts"], "engine-baseline", { deleted: "alpha.ts" });

  assert.equal(out.first.deliveryAccounting, "silent-baseline", "first real sync establishes a silent baseline");
  assert.equal(out.first.text, "", "baseline establishment emits no semantic notice");
  assert.equal(out.first.syncPreparationId, undefined, "baseline establishment has no receipt preparation");
  assert.equal(out.second.red, true, "a real source deletion must produce a red semantic verdict");
  assert.equal(out.second.deliveryAccounting, "prepared", "red verdict prepares a delivery receipt");
  assert.equal(typeof out.second.syncPreparationId, "string", "red verdict carries an exact preparation id");
  assert.match(out.second.text, /deleted alpha\.ts/u, "notice text comes from real extraction of the changed tree");
  assert.ok(out.second.details.deletedFiles.includes("alpha.ts"), "real extraction reports the deleted file");
  assert.notEqual(out.first.sourceSnapshotId, out.second.sourceSnapshotId, "real source snapshots differ across the change");
  assert.ok(out.first.coverage.sourceFiles > out.second.coverage.sourceFiles, "snapshot file counts reflect the real change");
  assert.ok(out.first.observationGap === false || out.first.observationGap === true, "observation gap is reported structurally");

  assert.match(out.wrongCommit.error, /Unknown or superseded sync preparation/u, "a fabricated receipt must fail closed");
  assert.equal(out.commit.deliveryAccounting, "acknowledged", "the exact prepared receipt commits the real engine baseline once");
  assert.match(out.recommit.error, /Unknown or superseded sync preparation/u, "a replayed receipt cannot commit twice");
  assert.equal(out.third.red, false, "after acknowledgement the real baseline is advanced");
  assert.equal(out.closeError, undefined, "real engine scratch teardown must complete");

  return { identity, first: summarize(out.first), second: summarize(out.second), wrongCommit: out.wrongCommit,
    commit: out.commit, recommit: out.recommit, third: summarize(out.third),
    realEngine: true, realParser: true, emissionWithoutAckPending: true, exactReceiptCommittedOnce: true };
}

async function engineSuperseded(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "superseded", workspaceFiles({ gamma: true }));
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts", "gamma.ts"], "engine-superseded", { deleted: "alpha.ts", deleted2: "gamma.ts" });

  assert.equal(typeof out.prepared1.syncPreparationId, "string");
  assert.equal(typeof out.prepared2.syncPreparationId, "string");
  assert.notEqual(out.prepared1.syncPreparationId, out.prepared2.syncPreparationId, "a newer red verdict supersedes the older preparation");
  assert.match(out.staleCommit.error, /Unknown or superseded sync preparation/u, "a superseded receipt fails closed");
  assert.equal(out.freshCommit.deliveryAccounting, "acknowledged", "only the current preparation commits");
  assert.equal(out.closeError, undefined, "real engine scratch teardown must complete");

  return { identity, prepared1: out.prepared1.syncPreparationId, prepared2: out.prepared2.syncPreparationId,
    staleCommit: out.staleCommit, freshCommit: out.freshCommit, supersededFailsClosed: true };
}

async function engineFocus(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "focus", workspaceFiles({ gamma: true }));
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts", "gamma.ts"], "engine-focus", { deleted: "gamma.ts" });

  assert.equal(out.focus1.status, "ok");
  assert.equal(typeof out.focus1.focusId, "string", "first focus establishes a real focus id");
  assert.equal(out.prepared.red, true, "source deletion prepares a baseline receipt after the first focus");
  assert.equal(typeof out.focus2.focusId, "string", "a fresh explicit focus creates a newer focus id");
  assert.notEqual(out.focus1.focusId, out.focus2.focusId, "the newer focus is distinct");
  assert.equal(out.commit.deliveryAccounting, "acknowledged");
  assert.equal(out.dwell.focusId, out.focus2.focusId, "a late baseline commit must not overwrite the newer explicit focus");
  assert.ok(out.dwell.focusRevision >= 2, "the newer focus remains active after the late commit");
  assert.equal(out.focus1.focusRevision, 1);
  assert.equal(out.closeError, undefined, "real engine scratch teardown must complete");

  return { identity, focus1: { focusId: out.focus1.focusId, revision: out.focus1.focusRevision },
    focus2: { focusId: out.focus2.focusId, revision: out.focus2.focusRevision },
    dwell: { focusId: out.dwell.focusId, revision: out.dwell.focusRevision },
    newerFocusPreserved: true };
}

async function engineNegativeControl(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "negative", workspaceFiles());
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts"], "engine-negative-control", { deleted: "alpha.ts" });

  assert.equal(out.first.deliveryAccounting, "silent-baseline");
  assert.equal(out.commentOnly.red, false, "a comment-only byte change is not a semantic structural change");
  assert.ok(out.commentOnly.details.changedFiles.includes("alpha.ts"), "the byte change is still observed");
  assert.ok(!out.commentOnly.details.semanticChangedFiles.includes("alpha.ts"), "the semantic fingerprint is unchanged");
  assert.equal(out.deletion.red, true, "a real deletion does trigger the semantic verdict");
  assert.ok(out.deletion.details.deletedFiles.includes("alpha.ts"));
  assert.equal(out.closeError, undefined, "real engine scratch teardown must complete");

  return { identity, commentOnly: { red: out.commentOnly.red, changedFiles: out.commentOnly.details.changedFiles,
    semanticChangedFiles: out.commentOnly.details.semanticChangedFiles }, deletion: { red: out.deletion.red },
    controlSeparatesBytesFromSemantics: true };
}

async function hostReceipt(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "host", workspaceFiles({ gamma: true }));
  const { dataRoot, configFile } = hostPaths(context);
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts", "gamma.ts"], "host-receipt", { deleted: "gamma.ts", dataRoot, configFile });

  assert.ok(out.claim && out.claim.text.length > 0, "real host must produce a real semantic notice claim");
  assert.match(out.claim.text, /deleted gamma\.ts/u, "host notice text comes from the real engine");
  assert.equal(out.bound, true, "the real adapter binds the host claim to its owner turn");
  assert.equal(out.preAck, false, "a prepared claim is not a model-input acknowledgement");
  assert.equal(out.tracked, true);
  assert.equal(out.emitted, 1, "transport emission advances the notice to emitted without committing");
  assert.equal(out.ack, true, "the exact receipt acknowledges exactly once");
  assert.equal(out.duplicate, false, "a replayed receipt cannot advance the baseline again");
  assert.equal(out.foreign, false, "a foreign turn cannot consume this receipt");
  assert.match(out.stale.error, /Foreign, stale or ended host turn/u, "an ended turn cannot acknowledge");
  assert.match(out.secondAck.error, /Unknown delivery preparation/u, "a committed receipt is removed and cannot be replayed");
  assert.equal(out.acknowledgements, 1, "the host acknowledgement callback runs exactly once");
  assert.equal(out.finalNotices.emitted, 0, "successful acknowledgement clears the emitted notice");
  assert.equal(out.status.retainedScratchGenerations, 0, "no engine scratch generation was retained after close-safe operation");
  assert.equal(out.hostClose, undefined, "real host/engine teardown must complete");

  return { identity, claim: out.claim.noticeId, emittedBeforeAck: out.emitted, acknowledgements: out.acknowledgements,
    finalNotices: out.finalNotices, engineStatus: out.status, foreignRejected: true, replayedRejected: true, staleRejected: true,
    realHost: true, realEngine: true };
}

async function hostAckFailure(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "host-failure", workspaceFiles({ gamma: true }));
  const { dataRoot, configFile } = hostPaths(context);
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts", "gamma.ts"], "host-ack-failure", { deleted: "gamma.ts", dataRoot, configFile });

  assert.ok(out.claim && out.claim.text.length > 0);
  assert.equal(out.emitted, 1);
  assert.match(out.failedAck.error, /simulated receipt failure/u, "a failed receipt callback surfaces");
  assert.equal(out.retainedAfterFailure, 1, "a failed receipt retains the emitted notice");
  assert.equal(out.autoRetry, false, "a failed receipt is not retried automatically");
  assert.equal(out.acknowledgementsAfterFailure, 1, "the failed receipt reached the callback exactly once");
  assert.ok(!("error" in out.explicitRetry), "an explicit retry eventually commits through the real engine");
  assert.equal(out.acknowledgements, 1);
  assert.equal(out.finalNotices.emitted, 0, "the explicit retry commits once and clears the notice");
  assert.equal(out.status.retainedScratchGenerations, 0, "no engine scratch generation was retained after close-safe operation");
  assert.equal(out.hostClose, undefined, "real host/engine teardown must complete");

  return { identity, claim: out.claim.noticeId, failedAck: out.failedAck, retainedAfterFailure: out.retainedAfterFailure,
    autoRetry: out.autoRetry, explicitRetry: out.explicitRetry, finalNotices: out.finalNotices, engineStatus: out.status,
    failedReceiptDoesNotAdvance: true, explicitRetryCommitsOnce: true };
}

async function identityControl(context) {
  const { artifacts, identity } = await prepare(context);
  const workspace = createSemanticWorkspace(context, "identity", workspaceFiles());
  const out = await runScenario(context, artifacts, generation, workspace.root, ["alpha.ts"], "engine-identity-control", {});

  assert.match(out.tampered.error, /Managed parser SHA-256 mismatch|Invalid managed parser descriptor/u, "a tampered parser identity is refused before execution");
  assert.equal(out.valid.deliveryAccounting, "silent-baseline", "the admitted generation still runs the real engine");
  assert.equal(out.runtime.execPath, generation.node, "the real engine ran under the admitted generation Node");
  assert.equal(out.closeError, undefined, "real engine scratch teardown must complete");

  return { identity, runtime: out.runtime, tampered: out.tampered, validAccounting: out.valid.deliveryAccounting,
    identityBindsSourceBuildParser: true, tamperedParserRefused: true };
}

// ---------------------------------------------------------------------------

function summarize(value) {
  return { deliveryAccounting: value.deliveryAccounting, red: value.red, text: typeof value.text === "string" ? value.text : "",
    syncPreparationId: value.syncPreparationId, sourceSnapshotId: value.sourceSnapshotId };
}

const effects = "offline real FoveaEngine/FoveaHost + real ast-grep parser + installed generation native source binding; "
  + "retained fixtures; not native qualification and not model-input receipt provenance";

function availability(run) {
  return prerequisite ? { implemented: true, unavailable: prerequisite } : { run };
}

export function createCases() {
  return [
    { id: "FN01", title: "real engine baseline and semantic notice from a real source snapshot", effects, deadlineMs: CASE_DEADLINE_MS,
      ...availability(context => engineBaseline(context)) },
    { id: "FN02", title: "superseded real receipt fails closed while the current preparation commits", effects, deadlineMs: CASE_DEADLINE_MS,
      ...availability(context => engineSuperseded(context)) },
    { id: "FN03", title: "late real baseline commit preserves a newer explicit focus", effects, deadlineMs: CASE_DEADLINE_MS,
      ...availability(context => engineFocus(context)) },
    { id: "FN04", title: "semantic fingerprint negative control separates byte drift from semantic drift", effects, deadlineMs: CASE_DEADLINE_MS,
      ...availability(context => engineNegativeControl(context)) },
    { id: "FN05", title: "real host + adapter emission/ack, failure retry and foreign/stale/replay rejection", effects, deadlineMs: LONG_CASE_DEADLINE_MS,
      ...availability(context => hostReceipt(context)) },
    { id: "FN06", title: "failed receipt does not advance; explicit retry commits once through the real engine", effects, deadlineMs: LONG_CASE_DEADLINE_MS,
      ...availability(context => hostAckFailure(context)) },
    { id: "FN07", title: "source/build/parser identity binding refuses a tampered parser", effects, deadlineMs: CASE_DEADLINE_MS,
      ...availability(context => identityControl(context)) },
  ];
}
