// Qualification-safety regressions: retain-only capability cleanup, inert-client
// child isolation, and negative controls over existing pure validators.
//
// Local development only, NOT native qualification. Every fixture is retained.
// No real kiro-cli, credential, network, install, Git write or fixture deletion.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateCaseRegistry, incompleteCaseResult } from "./case-contract.mjs";
import { runSuite } from "./runner.mjs";
import { privateDir, writeOwnerExecutable, kiroCliShim, runProbe, probeReport } from "./qualification-safety-fixture.mjs";
import { buildInertSmokeBundle } from "./qualification-smoke-bundle.mjs";
import { assertNativeHost } from "../release-native-evidence.mjs";
import { validateCompleteGateEvidence, validateCompleteQualification } from "../complete-release-promotion.mjs";
import { assertSafeQualificationPublication, withQualificationFailureReport } from "../qualification-failure.mjs";
import { summarizeHumanMatrix } from "../fovea-human-qualification.mjs";
import { sessionProbeExit } from "../fovea-session-probe.mjs";

export const requiredIds = ["QN01", "QN02", "QN03", "QN04", "QN05"];

/** @param {string} label @param {() => unknown} fn */
function rejected(label, fn) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught, "expected rejection: " + label);
  return label;
}

// Exact fixture identity witness, mirroring the inert backend's own snapshot.
// Directories contribute dev/ino/mode/uid/gid/nlink only (timestamps are not an
// identity contract); files additionally bind size, mtime/ctime and exact bytes.
/** @param {string} base @param {string[]} names */
function snapshotIdentities(base, names) {
  return names.map((relative) => {
    const file = path.resolve(base, relative);
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("unexpected identity witness type");
    const row = { relative, type: stat.isFile() ? "file" : "directory", dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), uid: String(stat.uid), gid: String(stat.gid), nlink: String(stat.nlink) };
    if (stat.isFile()) Object.assign(row, { size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), bytes: fs.readFileSync(file).toString("hex") });
    return row;
  });
}

// Exact backend env production smokeCandidate constructs (its explicit keys).
const SMOKE_BACKEND_KEYS = ["HOME", "KIRO_HOME", "PATH", "LANG", "LC_ALL", "KIRO_FABRIC_BUNDLE_ROOT", "KIRO_FABRIC_RUNTIME_ROOT", "KIRO_FABRIC_EXPECTED_NODE", "KIRO_FABRIC_RG", "KIRO_FABRIC_DATA_ROOT"].sort();

/** @returns {any[]} */
export function createCases() {
  return [
    {
      id: "QN01",
      title: "capability probe retains a repository-bearing private scope and isolates child commands",
      effects: "spawns the probe once with an inert task-owned kiro-cli shim writing inside the scope; retained fixtures; no real client/network/credential/real-home access",
      deadlineMs: 60000,
      run: async (context) => {
        const bin = privateDir(context.fixturesRoot, "qn01-bin");
        writeOwnerExecutable(bin, "kiro-cli", kiroCliShim(process.execPath, "success"));
        const sandbox = privateDir(context.fixturesRoot, "qn01-tmp");
        const env = {
          PATH: bin,
          HOME: path.join(context.fixturesRoot, "qn01-fake-home"),
          TMPDIR: sandbox,
          QN_DECOY_SECRET: "must-not-propagate",
          OPENROUTER_API_KEY: "decoy-not-a-credential",
          AWS_SECRET_ACCESS_KEY: "decoy-not-a-credential",
          LC_ALL: "C",
        };
        const result = runProbe(context, [], env);
        assert.equal(result.code, 0, "probe must exit zero without qualification; stderr: " + result.stderr);
        const report = probeReport(result);
        assert.equal(report.qualified, false);
        assert.equal(report.automatic, false);
        assert.equal(report.scopeRemoved, false, "scope must never be reported removed");
        assert.equal(report.scopeDisposition, "retained");
        assert.equal(report.processCleanup, "confirmed", "process cleanup must be reported separately and truthfully");
        assert.ok(typeof report.scopeRetained === "string" && path.isAbsolute(report.scopeRetained), "the report must name the retained scope: " + JSON.stringify(report.scopeRetained));
        const scope = report.scopeRetained;
        assert.equal(path.dirname(scope), fs.realpathSync(sandbox), "the scope must be created under the controlled TMPDIR");
        const stat = fs.statSync(scope);
        assert.equal(stat.isDirectory(), true);
        assert.equal(stat.mode & 0o777, 0o700, "the retained scope must stay private");
        assert.equal(stat.uid, process.getuid?.());
        // Repository metadata written by the inert shim survives retention.
        const git = path.join(scope, "kiro", "child-repo", ".git");
        assert.equal(fs.readFileSync(path.join(git, "config"), "utf8"), "[core]\n\trepositoryformatversion = 0\n");
        assert.equal(fs.readFileSync(path.join(git, "HEAD"), "utf8"), "ref: refs/heads/main\n");
        // Child command isolation: the shim sees only scope-relative homes.
        const shimEnv = JSON.parse(fs.readFileSync(path.join(scope, "kiro", "shim-env.json"), "utf8"));
        assert.equal(shimEnv.HOME, path.join(scope, "home"));
        assert.equal(shimEnv.KIRO_HOME, path.join(scope, "kiro"));
        assert.equal(shimEnv.TMPDIR, path.join(scope, "tmp"));
        assert.equal(fs.readFileSync(path.join(scope, "kiro", "shim-cwd.txt"), "utf8"), path.join(scope, "workspace"));
        for (const decoy of ["QN_DECOY_SECRET", "OPENROUTER_API_KEY", "AWS_SECRET_ACCESS_KEY"]) {
          assert.equal(Object.hasOwn(shimEnv, decoy), false, "parent secret must not reach the child: " + decoy);
        }
        // Exact ownership: TMPDIR holds exactly the one scope; PATH holds only the shim.
        assert.deepEqual(fs.readdirSync(sandbox), [path.basename(scope)]);
        assert.deepEqual(fs.readdirSync(bin), ["kiro-cli"]);
        return { scopeRetained: true, repositoryPreserved: true, processCleanup: report.processCleanup, childSecretsLeaked: 0, sandboxEntries: 1, realClientExecuted: false };
      },
    },
    {
      id: "QN02",
      title: "capability probe retains its scope across failure and missing-prerequisite paths",
      effects: "spawns the probe with a failing inert shim and with an empty PATH; retained fixtures; no real client",
      deadlineMs: 60000,
      run: async (context) => {
        const variants = [];
        {
          const bin = privateDir(context.fixturesRoot, "qn02-fail-bin");
          writeOwnerExecutable(bin, "kiro-cli", kiroCliShim(process.execPath, "failure"));
          const sandbox = privateDir(context.fixturesRoot, "qn02-fail-tmp");
          const result = runProbe(context, [], { PATH: bin, HOME: path.join(context.fixturesRoot, "qn02-fail-home"), TMPDIR: sandbox });
          assert.equal(result.code, 0, result.stderr);
          const report = probeReport(result);
          assert.equal(report.qualified, false);
          assert.equal(report.scopeRemoved, false);
          assert.equal(report.scopeDisposition, "retained");
          assert.equal(report.processCleanup, "confirmed");
          assert.ok(report.probes.some((probe) => probe.exitCode === 3 || probe.status === "failed"), "a failing child must be reported, not hidden: " + JSON.stringify(report.probes.map((probe) => [probe.id, probe.status, probe.exitCode])));
          const scope = report.scopeRetained;
          assert.ok(typeof scope === "string" && fs.existsSync(path.join(scope, "kiro", "child-repo", ".git", "config")), "repository metadata must survive a failing child");
          assert.deepEqual(fs.readdirSync(sandbox), [path.basename(scope)]);
          variants.push({ name: "failure", retained: true, shimExit: 3, processCleanup: report.processCleanup });
        }
        {
          const bin = privateDir(context.fixturesRoot, "qn02-missing-bin");
          const sandbox = privateDir(context.fixturesRoot, "qn02-missing-tmp");
          const result = runProbe(context, [], { PATH: bin, HOME: path.join(context.fixturesRoot, "qn02-missing-home"), TMPDIR: sandbox });
          assert.equal(result.code, 0, result.stderr);
          const report = probeReport(result);
          assert.equal(report.scopeRemoved, false);
          assert.equal(report.scopeDisposition, "retained");
          assert.equal(report.processCleanup, "confirmed");
          assert.equal(report.probes[0].error, "ENOENT", "a missing prerequisite must be reported truthfully: " + JSON.stringify(report.probes[0]));
          assert.ok(typeof report.scopeRetained === "string" && fs.existsSync(report.scopeRetained), "the scope must survive a missing prerequisite");
          variants.push({ name: "missing-prerequisite", retained: true, spawnError: "ENOENT", processCleanup: report.processCleanup });
        }
        return { variants, scopePreservedOnFailure: true, scopePreservedOnMissingPrerequisite: true };
      },
    },
    {
      id: "QN03",
      title: "case registry and completeness validators reject malformed, missing and foreign registries without broadening availability semantics",
      effects: "pure validator calls plus one non-executing unavailable runSuite registration; no processes and no fixture writes",
      deadlineMs: 30000,
      run: async (context) => {
        const good = [{ id: "SELFTEST-PASS", title: "control", run: async () => ({ control: "pass" }) }];
        assert.deepEqual(validateCaseRegistry("self-test-pass", good, ["SELFTEST-PASS"]).problems, []);
        const rejectedRegistries = [
          rejected("empty registry", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [], ["SELFTEST-PASS"]).problems, [])),
          rejected("foreign suite", () => assert.deepEqual(validateCaseRegistry("no-such-suite", good, ["SELFTEST-PASS"]).problems, [])),
          rejected("missing required id", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [], ["SELFTEST-PASS"]).problems, [])),
          rejected("declared id mismatch", () => assert.deepEqual(validateCaseRegistry("self-test-pass", good, ["SELFTEST-PASS", "EXTRA"]).problems, [])),
          rejected("unknown id", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [{ id: "X", run: async () => ({}) }], ["SELFTEST-PASS"]).problems, [])),
          rejected("duplicate id", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [good[0], good[0]], ["SELFTEST-PASS"]).problems, [])),
          rejected("no implementation", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [{ id: "SELFTEST-PASS" }], ["SELFTEST-PASS"]).problems, [])),
          rejected("invalid deadline", () => assert.deepEqual(validateCaseRegistry("self-test-pass", [{ id: "SELFTEST-PASS", run: async () => ({}), deadlineMs: 0 }], ["SELFTEST-PASS"]).problems, [])),
        ];
        assert.notEqual(incompleteCaseResult({ status: "unavailable" }), null);
        assert.notEqual(incompleteCaseResult({ status: "failed" }), null);
        assert.notEqual(incompleteCaseResult({ coverageGaps: ["native"] }), null);
        assert.notEqual(incompleteCaseResult([]), null);
        assert.equal(incompleteCaseResult({ status: "passed" }), null);
        assert.equal(incompleteCaseResult({ coverageGaps: [] }), null);
        // Documented boundary, deliberately NOT broadened: bare `available` /
        // `unavailable` facts are not the runner completeness schema. Explicit
        // absence must be a registry `unavailable` string, or a non-passed
        // status / nonempty coverageGaps.
        const documentedNonSchemaFacts = {
          bareAvailableFalse: incompleteCaseResult({ available: false }),
          bareUnavailableString: incompleteCaseResult({ unavailable: "missing client" }),
          bareEmptyFacts: incompleteCaseResult({}),
        };
        assert.equal(documentedNonSchemaFacts.bareAvailableFalse, null);
        assert.equal(documentedNonSchemaFacts.bareUnavailableString, null);
        assert.equal(documentedNonSchemaFacts.bareEmptyFacts, null);
        const unavailableCases = [{ id: "SELFTEST-PASS", title: "unavailable native control", unavailable: "not launched" }];
        assert.deepEqual(validateCaseRegistry("self-test-pass", unavailableCases, ["SELFTEST-PASS"]).problems, []);
        const report = await runSuite({
          suite: "self-test-pass", cases: unavailableCases, requiredIds: ["SELFTEST-PASS"],
          root: context.root, fixturesRoot: context.fixturesRoot, identityDigest: {}, reportDir: context.fixturesRoot, stderr: () => {},
        });
        assert.equal(report.ok, false);
        assert.equal(report.qualification, false);
        assert.equal(report.counts.unavailable, 1);
        assert.equal(report.counts.executed, 0, "a registered unavailable case must not execute a worker");
        return { rejectedRegistries: rejectedRegistries.length, rejectedPartialResults: 4, documentedNonSchemaFacts: 3, registeredUnavailablePreventsSuccess: true };
      },
    },
    {
      id: "QN04",
      title: "native, foreign, unavailable and raw evidence negative controls keep false success rejected",
      effects: "pure in-process validator calls only; no processes, clients, network or fixture writes",
      deadlineMs: 30000,
      run: async () => {
        const nativeHost = [
          rejected("foreign platform target", () => assertNativeHost("linux-x64", { platform: "darwin", arch: "arm64", machine: "arm64", translated: "0" })),
          rejected("unknown darwin translation", () => assertNativeHost("darwin-arm64", { platform: "darwin", arch: "arm64", machine: "arm64", translated: null })),
          rejected("machine mismatch", () => assertNativeHost("darwin-arm64", { platform: "darwin", arch: "arm64", machine: "x86_64", translated: "0" })),
        ];
        const metadata = { target: "darwin-arm64", version: "1.0.0", sourceCommit: "c".repeat(40), bundleDigest: "b".repeat(64), archive: { sha256: "a".repeat(64) } };
        const metadataBytes = Buffer.from(JSON.stringify(metadata));
        // sha256(JSON.stringify(metadata)) for this exact fixed shape: the receipt
        // binds metadata bytes, not merely the field values.
        const metadataSha256 = "e972f9b0b028416cab97c81ab7feccd5631e33c4fce05f0599d6fcf0961be1e1";
        const host = { platform: "darwin", arch: "arm64", machine: "arm64", translated: "0" };
        const clientChecks = ["authoritativeToolInventory", "acceptedEdit", "declinedEdit", "acceptedShell", "declinedShell", "workspaceRevocation", "compaction", "resume", "shutdown"];
        const baseEvidence = () => ({ schema: 1, kind: "kiro-fabric.complete-client-evidence", target: metadata.target, sourceCommit: metadata.sourceCommit, archiveSha256: metadata.archive.sha256, bundleDigest: metadata.bundleDigest, host, checks: Object.fromEntries(clientChecks.map((check) => [check, true])), witnesses: [{ sha256: "d".repeat(64), size: 1 }] });
        assert.equal(validateCompleteGateEvidence(baseEvidence(), "client", metadata).kind, "kiro-fabric.complete-client-evidence", "the validator must not be vacuous");
        const completeQualification = [
          rejected("empty qualification", () => validateCompleteQualification({}, {}, Buffer.alloc(0))),
          rejected("wrong qualification kind", () => validateCompleteQualification({ schema: 1, kind: "nope" }, metadata, Buffer.alloc(0))),
        ];
        // A fully shaped, otherwise-valid complete receipt MUST be accepted by the
        // real production validator, then that same receipt is mutated across every
        // fail-closed dimension. Without this positive acceptance a malformed-only
        // validator would keep this case green.
        const validCompleteReceipt = () => ({
          schema: 1, kind: "kiro-fabric.complete-qualification",
          target: metadata.target, version: metadata.version, sourceCommit: metadata.sourceCommit,
          bundleDigest: metadata.bundleDigest, archiveSha256: metadata.archive.sha256, metadataSha256,
          gates: ["native", "installed", "client", "minimum-system"].map((gate) => ({ gate, status: "passed", evidence: { size: 1, sha256: "d".repeat(64) } })),
        });
        assert.equal(validateCompleteQualification(validCompleteReceipt(), metadata, metadataBytes).gates.length, 4, "a full valid complete receipt must be accepted");
        /** @type {Array<[string, (value:any)=>void]>} */
        const receiptMutations = [
          ["missing gate", (value) => { value.gates.pop(); }],
          ["duplicate gate", (value) => { value.gates[1] = value.gates[0]; }],
          ["failed gate", (value) => { value.gates[0].status = "failed"; }],
          ["unavailable gate", (value) => { value.gates[0].status = "unavailable"; }],
          ["non-passed mode gate", (value) => { value.gates[2].status = "skipped"; }],
          ["missing gate evidence", (value) => { delete value.gates[0].evidence; }],
          ["zero evidence size", (value) => { value.gates[0].evidence.size = 0; }],
          ["oversized evidence size", (value) => { value.gates[0].evidence.size = 16 * 1024 * 1024 + 1; }],
          ["forged evidence hash", (value) => { value.gates[0].evidence.sha256 = "z".repeat(64); }],
          ["evidence mode field", (value) => { value.gates[0].evidence.mode = "0600"; }],
          ["identity target mismatch", (value) => { value.target = "linux-x64"; }],
          ["identity version mismatch", (value) => { value.version = "9.9.9"; }],
          ["identity commit mismatch", (value) => { value.sourceCommit = "e".repeat(40); }],
          ["identity bundle digest mismatch", (value) => { value.bundleDigest = "f".repeat(64); }],
          ["identity archive mismatch", (value) => { value.archiveSha256 = "9".repeat(64); }],
          ["identity metadata hash mismatch", (value) => { value.metadataSha256 = "f".repeat(64); }],
          ["extra top-level field", (value) => { value.releaseReady = true; }],
        ];
        const completeReceiptRejections = receiptMutations.map(([label, mutate]) => rejected(label, () => { const value = validCompleteReceipt(); mutate(value); return validateCompleteQualification(value, metadata, metadataBytes); }));
        const gateEvidence = [
          rejected("unavailable-shaped evidence", () => validateCompleteGateEvidence({ available: false }, "client", metadata)),
          rejected("smoke-shaped evidence", () => validateCompleteGateEvidence({ kind: "kiro-fabric.native-bundle-smoke", ok: true, releaseReady: false }, "client", metadata)),
          rejected("false mandatory check", () => { const value = baseEvidence(); value.checks.resume = false; return validateCompleteGateEvidence(value, "client", metadata); }),
          rejected("empty witnesses", () => { const value = baseEvidence(); value.witnesses = []; return validateCompleteGateEvidence(value, "client", metadata); }),
          rejected("invalid witness hash", () => { const value = baseEvidence(); value.witnesses = [{ sha256: "z".repeat(64), size: 1 }]; return validateCompleteGateEvidence(value, "client", metadata); }),
          rejected("foreign host translation", () => { const value = baseEvidence(); value.host = { ...host, translated: null }; return validateCompleteGateEvidence(value, "client", metadata); }),
        ];
        const publication = [
          rejected("top-level transcript", () => assertSafeQualificationPublication({ transcript: [] })),
          rejected("nested raw field", () => assertSafeQualificationPublication({ a: { b: { c: { raw: "x" } } } })),
          rejected("nested stdout field", () => assertSafeQualificationPublication({ results: [{ stdout: "x" }] })),
        ];
        assert.equal(assertSafeQualificationPublication({ a: { b: [1, 2], c: "safe" } }), undefined);
        let retained = null;
        try { await withQualificationFailureReport({ component: "wrapper", cleanupKind: "authHome", cleanup: () => "retained" }, async () => "unused"); }
        catch (error) { retained = error; }
        assert.equal(retained && retained.code, "QUALIFICATION_STATE_RETAINED");
        assert.equal(await withQualificationFailureReport({ component: "wrapper", cleanupKind: "authHome", cleanup: () => "not-created" }, async () => "ok"), "ok");
        const matrix = summarizeHumanMatrix([]);
        assert.equal(matrix.matrixObserved, false);
        assert.equal(matrix.qualified, false);
        assert.equal(matrix.automatic, false);
        assert.equal(matrix.cases.length, 6);
        assert.equal(sessionProbeExit({ diagnosticCompleted: false }), 2);
        assert.equal(sessionProbeExit({ diagnosticCompleted: true, nativeSessionIsolation: { status: "failed" } }), 3);
        assert.equal(sessionProbeExit({ diagnosticCompleted: true, nativeSessionIsolation: { status: "unqualified" } }), 0);
        return { nativeHostRejections: nativeHost.length, gateEvidenceRejections: gateEvidence.length, completeQualificationRejections: completeQualification.length, completeReceiptAcceptance: 1, completeReceiptRejections: completeReceiptRejections.length, publicationRejections: publication.length, retentionBlocksSuccess: true, humanMatrixNonQualifying: true, sessionDiagnosticNonQualifying: true };
      },
    },
    {
      id: "QN05",
      title: "real smokeCandidate retains failed- and successful-backend private scratch containing .git and bare repository metadata",
      effects: "builds an inert task-owned schema-1 fixture bundle (shim tools/node backend, placeholder app closure) and spawns a bounded helper that invokes the real production smokeCandidate; retained fixtures; no real backend/native client, network, credential, install, Git mutation, recursive cleanup or fixture deletion",
      deadlineMs: 60000,
      run: async (context) => {
        const productionSource = fs.readFileSync(path.join(context.root, "scripts", "installer-smoke.mjs"), "utf8");
        const child = path.join(context.root, "scripts", "verification", "qualification-smoke-child.mjs");

        const runVariant = async (mode, label) => {
          const bundle = await buildInertSmokeBundle(privateDir(context.fixturesRoot, "qn05-" + mode + "-bundle"), mode);
          const sandbox = privateDir(context.fixturesRoot, "qn05-" + mode + "-tmp");
          const env = {
            PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: sandbox,
            HOME: path.join(context.fixturesRoot, "qn05-" + mode + "-parent-home"),
            QN_DECOY_SECRET: "must-not-propagate", OPENROUTER_API_KEY: "decoy-not-a-credential",
            AWS_SECRET_ACCESS_KEY: "decoy-not-a-credential", HTTP_PROXY: "decoy", BASH_ENV: "decoy",
          };
          const probe = context.spawn(process.execPath, [child, JSON.stringify({ bundleRoot: bundle.root })], { cwd: context.root, env, timeoutMs: 60000 });
          assert.equal(probe.spawnError, null, label + " helper spawn error: " + probe.spawnError);
          assert.equal(probe.timedOut, false, label + " helper exceeded the real harness budget");
          assert.equal(probe.code, 0, label + " helper must report truthfully; stderr: " + probe.stderr);
          const outcome = JSON.parse(probe.stdout);
          assert.equal(outcome.schemaVersion, 1);

          // The logged retention path is the actual, privately created scratch.
          const noticeMatch = probe.stderr.match(/\[fabric:task-root\] (\{[^\n]*\})\n?/u);
          assert.ok(noticeMatch, label + " must log the retention notice before the backend: " + JSON.stringify(probe.stderr));
          const notice = JSON.parse(noticeMatch[1]);
          assert.equal(notice.policy, "retain");
          assert.equal(notice.source, "candidate-smoke");
          assert.ok(typeof notice.path === "string" && path.isAbsolute(notice.path), label + " notice must name an absolute path");
          assert.equal(path.dirname(notice.path), fs.realpathSync(sandbox), label + " retained scratch must live under the controlled TMPDIR");
          assert.deepEqual(fs.readdirSync(sandbox), [path.basename(notice.path)], label + " sandbox must hold exactly the one retained scratch");
          const stat = fs.statSync(notice.path);
          assert.equal(stat.isDirectory(), true);
          assert.equal(stat.mode & 0o777, 0o700, label + " retained scratch must stay private 0700");
          assert.equal(stat.uid, process.getuid?.());

          // Repository metadata the inert backend created survives unchanged.
          const workspace = path.join(notice.path, "workspace");
          const expected = [
            [".git/config", "[core]\n\trepositoryformatversion = 0\n"],
            [".git/HEAD", "ref: refs/heads/main\n"],
            [".git/fabric-retention-token", bundle.token + "\n"],
            ["bare.git/HEAD", "ref: refs/heads/main\n"],
            ["bare.git/config", "[core]\n\tbare = true\n"],
            ["bare.git/fabric-retention-token", bundle.token + "\n"],
            ["retention-sentinel.txt", bundle.token + "\n"],
          ];
          for (const [relative, contents] of expected) {
            const file = path.join(workspace, relative);
            assert.equal(fs.existsSync(file), true, label + " repository metadata must survive retention: " + relative);
            assert.equal(fs.readFileSync(file, "utf8"), contents, label + " metadata bytes changed: " + relative);
          }
          for (const relative of [".git/objects", "bare.git/objects"]) {
            assert.equal(fs.statSync(path.join(workspace, relative)).isDirectory(), true, label + " objects directory must survive retention: " + relative);
          }

          // Pre/post scope identity: the inert backend snapshotted dev/inode/mode/
          // uid/gid/nlink and exact file bytes immediately before exit/handshake;
          // re-stat now that the real production lifecycle has returned.
          const identityBefore = JSON.parse(fs.readFileSync(path.join(workspace, "inert-identity.json"), "utf8"));
          const identityAfter = snapshotIdentities(workspace, identityBefore.map((entry) => entry.relative));
          assert.deepEqual(identityAfter, identityBefore, label + " scope inode/mode/owner/link and file byte identity must be unchanged");

          // Env isolation: decoys must not reach the inert backend and the backend
          // must see only the production-constructed key set bound to scratch.
          const backendEnv = JSON.parse(fs.readFileSync(path.join(workspace, "inert-env.json"), "utf8"));
          const expectedKeys = SMOKE_BACKEND_KEYS.slice();
          if (process.platform === "darwin") { expectedKeys.push("__CF_USER_TEXT_ENCODING"); expectedKeys.sort(); }
          assert.deepEqual(Object.keys(backendEnv).sort(), expectedKeys, label + " backend env must be the exact production key set");
          for (const decoy of ["QN_DECOY_SECRET", "OPENROUTER_API_KEY", "AWS_SECRET_ACCESS_KEY", "HTTP_PROXY", "BASH_ENV"]) {
            assert.equal(Object.hasOwn(backendEnv, decoy), false, label + " parent decoy must not reach the backend: " + decoy);
          }
          assert.equal(backendEnv.HOME, path.join(notice.path, "home"), label + " backend HOME must be bound to scratch");
          assert.equal(backendEnv.KIRO_HOME, path.join(notice.path, "home", ".kiro"), label + " backend KIRO_HOME must be bound to scratch");
          assert.equal(backendEnv.KIRO_FABRIC_DATA_ROOT, path.join(notice.path, "data"), label + " backend data root must be bound to scratch");
          return { outcome, notice, expected, workspace, helperStdout: probe.stdout, helperStderr: probe.stderr,
            identityWitnesses: identityBefore.length,
            fileByteWitnesses: identityBefore.filter((entry) => entry.type === "file").length,
            objectsPreserved: true, backendEnvKeys: expectedKeys.length, backendEnvIsolated: true };
        };

        const failure = await runVariant("failure", "failed-backend");
        assert.equal(failure.outcome.rejected, true, "a failed backend must reject: " + JSON.stringify(failure.outcome));
        assert.match(failure.outcome.error, /Candidate shutdown failed \(3\)/u, "rejection must be the truthful production error: " + failure.outcome.error);
        assert.equal(Object.hasOwn(failure.outcome, "result"), false, "a failed backend must not return a result");

        const success = await runVariant("success", "successful-smoke");
        assert.equal(success.outcome.rejected, false, "the inert backend must satisfy the real smoke contract: " + JSON.stringify(success.outcome));
        assert.deepEqual(success.outcome.result, { integrity: "PASS", privateTools: "PASS", backend: "PASS", authenticatedKiro: "NOT TESTED" });

        // Structural production proof: the fix is retain-only and the deadlines are unchanged.
        assert.match(productionSource, /\[fabric:task-root\]/u);
        assert.match(productionSource, /policy: "retain", source: "candidate-smoke"/u);
        assert.ok(!/fs\.rmSync|fs\.rm\s*\(|rmdirSync/u.test(productionSource), "smokeCandidate must not recursively remove the retained scratch");
        assert.match(productionSource, /Candidate backend smoke timed out"\)\), 30000\)/u, "production backend deadline must stay 30000ms");
        assert.match(productionSource, /child\.kill\("SIGKILL"\), 33000\)/u, "production kill deadline must stay 33000ms");

        return {
          schema: "qn05-inert-smoke-retention",
          injectedBackend: true,
          nativeEvidence: false,
          oldProductionMutantExecuted: false,
          recursiveRemovalAbsent: true,
          productionDeadlineMs: 30000,
          productionKillMs: 33000,
          productionSourceSha256: createHash("sha256").update(productionSource).digest("hex"),
          variants: [
            { name: "failed-backend", rejected: true, scratchRetained: true, scratchMode0700: true, noticePolicy: "retain", noticeSource: "candidate-smoke", sandboxEntries: 1, identityWitnesses: failure.identityWitnesses, fileByteWitnesses: failure.fileByteWitnesses, backendEnvKeys: failure.backendEnvKeys, backendEnvIsolated: true, objectsPreserved: true },
            { name: "successful-smoke", rejected: false, scratchRetained: true, scratchMode0700: true, noticePolicy: "retain", noticeSource: "candidate-smoke", sandboxEntries: 1, identityWitnesses: success.identityWitnesses, fileByteWitnesses: success.fileByteWitnesses, backendEnvKeys: success.backendEnvKeys, backendEnvIsolated: true, objectsPreserved: true },
          ],
          repositoryMetadataPreserved: true,
          bareRepositoryMetadataPreserved: true,
          repositoryObjectsPreserved: true,
          scopeIdentityPreserved: true,
          backendEnvIsolated: true,
          preservedEntries: failure.expected.map(([relative]) => relative).length,
          identityWitnessesPerVariant: failure.identityWitnesses,
          fileByteWitnessesPerVariant: failure.fileByteWitnesses,
          evidence: {
            failedBackend: { notice: failure.notice, rejection: failure.outcome.error, retainedWorkspace: failure.workspace, helperStderr: failure.helperStderr },
            successfulSmoke: { notice: success.notice, result: success.outcome.result, retainedWorkspace: success.workspace, helperStderr: success.helperStderr },
          },
        };
      },
    },
  ];
}
