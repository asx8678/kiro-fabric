import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FabricTraceSafeError } from "../audit/trace.js";
import { writeJsonAtomic } from "../core/atomic-write.js";
import {
  processInstanceIdentity,
  processInstanceIsAlive,
} from "../core/process-instance.js";
import type { FabricSchemaConfig, FabricSchemaTrustedCommand } from "../config.js";
import type { MeshIdentity, MeshStateEntry, MeshStore } from "../mesh/store.js";
import type { FabricInvocationContext } from "../protocol.js";
import type { StateStore } from "../state/store.js";
import {
  type SchemaCertificateRecord,
  type SchemaEvidence,
  type SchemaEvidenceResult,
  type SchemaFileOperation,
  type SchemaHypothesisRecord,
  type SchemaWorkspaceRecord,
  stateBinding,
} from "./types.js";
import {
  resolveWorkspaceFile,
  sha256File,
  snapshotWorkspace,
  type WorkspaceSnapshot,
} from "./workspace.js";

const SCHEMA_TOPIC = "fabric.schema";
const WORKSPACE_KEY = "schema/workspace";
const HYPOTHESIS_PREFIX = "schema/hypothesis/";
const CERTIFICATE_PREFIX = "schema/certificate/";
const OUTPUT_LIMIT = 64 * 1024;

interface BeforeImage {
  path: string;
  absolute: string;
  existed: boolean;
  content?: string;
  mode?: number;
}

interface JournalOperation {
  path: string;
  kind: SchemaFileOperation["kind"];
  sourceSha256: string | null;
  resultSha256?: string;
  /** Same-directory staged result, whose bytes are owned by resultSha256. */
  temporary?: string;
  /** Same-directory before-file claimed atomically during publication. */
  backup?: string;
  /** Deterministic claim used while conditionally removing a published result. */
  rollbackClaim?: string;
  /** Deterministic, source-digest-owned staging file used to restore a before image. */
  restoreTemporary?: string;
  restoreSha256?: string;
}

interface TransactionJournal {
  format: 3;
  id: string;
  status: "prepared" | "applying" | "committed" | "rolled_back" | "quarantined";
  before: BeforeImage[];
  /** Project-relative same-directory stages/backups, recorded before creation. */
  staged: string[];
  operations: JournalOperation[];
  createdAt: number;
  error?: string;
}

interface StagedOperation {
  operation: SchemaFileOperation;
  path: string;
  absolute: string;
  sourceSha256: string | null;
  temporary?: string;
  resultSha256?: string;
  backup?: string;
  rollbackClaim?: string;
  restoreTemporary?: string;
  restoreSha256?: string;
}

interface CommitLockOwner {
  format: 1 | 2;
  nonce: string;
  pid: number;
  createdAt: number;
  bootId?: string;
  processStart?: string;
}

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const sameBinding = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fsyncFile = (filePath: string): void => {
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

const fsyncDirectory = (directory: string): void => {
  // Directory fsync is supported by the POSIX filesystems on which the
  // transaction protocol provides crash durability. Windows can reject
  // opening directories; publication atomicity still holds there.
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const atomicJsonWrite = (filePath: string, value: unknown): void => {
  writeJsonAtomic(filePath, value, { newline: true });
  fsyncFile(filePath);
  fsyncDirectory(path.dirname(filePath));
};

const allowedEnforceRefs = new Set([
  "pi.read",
  "pi.grep",
  "pi.find",
  "pi.ls",
  "memory.recall",
  "memory.expand",
  "memory.sessions",
  "state.get",
  "state.history",
  "state.complexity",
  "mesh.self",
  "mesh.read",
  "mesh.members",
  "mesh.get",
  "mesh.list",
  "compact.status",
  "components.list",
  "components.status",
  "components.graph",
  "schema.status",
  "schema.hypothesize",
  "schema.verify",
  "schema.commit",
  "schema.abort",
]);

const operationPath = (operation: SchemaFileOperation): string => operation.path;

export class SchemaController {
  readonly #activeHypotheses = new Map<string, string>();
  readonly #activeCertificates = new Map<string, string>();
  readonly #journalRoot: string;
  readonly #lockPath: string;

  constructor(
    readonly cwd: string,
    readonly config: FabricSchemaConfig,
    readonly mesh: MeshStore,
    readonly identity: MeshIdentity,
    readonly state?: StateStore,
  ) {
    this.cwd = fs.realpathSync(cwd);
    this.#journalRoot = path.join(mesh.root, "schema-transactions");
    this.#lockPath = path.join(this.#journalRoot, ".commit.lock");
    this.#recoverJournals();
  }

  async authorize(ref: string, parentToolCallId: string): Promise<void> {
    if (this.config.mode === "off" || allowedEnforceRefs.has(ref)) return;
    const message = `Schema ${this.config.mode} policy would block ${ref}: protected workspace mutations and external effects must use schema.commit`;
    if (this.config.mode === "audit") {
      try {
        await this.#publish("would_block", { ref, parentToolCallId, message });
      } catch {
        // Audit reporting is best-effort; audit mode must preserve current behavior.
      }
      return;
    }
    try {
      await this.#publish("blocked", { ref, parentToolCallId, message });
    } catch {
      // The authorization decision remains fail-closed if reporting is unavailable.
    }
    throw new FabricTraceSafeError(message);
  }

  status(parentToolCallId?: string): Record<string, unknown> {
    const workspace = this.#workspaceEntry();
    const hypotheses = this.mesh
      .list(HYPOTHESIS_PREFIX, this.mesh.maxReadEvents)
      .map((entry) => entry.value as SchemaHypothesisRecord)
      .filter((record) => !parentToolCallId || record.parentToolCallId === parentToolCallId)
      .map((record) => ({
        id: record.id,
        label: record.label,
        status: record.status,
        generation: record.generation,
        updatedAt: record.updatedAt,
      }));
    return {
      mode: this.config.mode,
      certificateTtlMs: this.config.certificateTtlMs,
      maxFiles: this.config.maxFiles,
      maxBytes: this.config.maxBytes,
      trustedCommands: Object.keys(this.config.trustedCommands).sort(),
      generation: (workspace?.value as SchemaWorkspaceRecord | undefined)?.generation ?? 0,
      lastOutcome: (workspace?.value as SchemaWorkspaceRecord | undefined)?.lastOutcome ?? null,
      hypotheses,
    };
  }

  async hypothesize(
    input: {
      label: string;
      summary: string;
      evidence: SchemaEvidence[];
      complexityReduction?: boolean;
    },
    context: FabricInvocationContext,
  ): Promise<Record<string, unknown>> {
    if (!input.label.trim() || !input.summary.trim()) throw new Error("Schema hypothesis label and summary must not be empty");
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
      throw new Error("Schema hypothesis requires nonempty typed evidence");
    }
    if (input.evidence.length > this.config.maxFiles) {
      throw new Error(`Schema hypothesis exceeds ${this.config.maxFiles} evidence items`);
    }
    this.#assertPayloadBound(input);
    const snapshot = snapshotWorkspace(this.cwd, [this.mesh.root]);
    const generation = this.#generation();
    const now = Date.now();
    const record: SchemaHypothesisRecord = {
      id: randomUUID(),
      label: input.label,
      summary: input.summary,
      evidence: input.evidence,
      complexityReduction: input.complexityReduction === true,
      parentToolCallId: context.parentToolCallId,
      state: stateBinding(this.state?.getHead() ?? null),
      fingerprint: snapshot.fingerprint,
      generation,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.#publish("hypothesized", record);
    await this.mesh.put({
      key: `${HYPOTHESIS_PREFIX}${record.id}`,
      value: record,
      ifVersion: 0,
      identity: this.identity,
    });
    this.#activeHypotheses.set(record.id, context.parentToolCallId);
    context.update(`Schema hypothesis recorded: ${record.label}`);
    return {
      hypothesisId: record.id,
      status: record.status,
      state: record.state,
      fingerprint: record.fingerprint,
      generation,
    };
  }

  async verify(
    hypothesisId: string,
    context: FabricInvocationContext,
  ): Promise<Record<string, unknown>> {
    const entry = this.#requireHypothesis(hypothesisId);
    const record = entry.value as SchemaHypothesisRecord;
    this.#assertInvocation(record.parentToolCallId, context.parentToolCallId);
    if (record.status !== "active") throw new Error(`Schema hypothesis is not active: ${record.status}`);
    if (record.evidence.length === 0) return this.#failedVerification(record, [], "missing evidence");

    let before: WorkspaceSnapshot;
    try {
      before = snapshotWorkspace(this.cwd, [this.mesh.root]);
    } catch (error) {
      return this.#failedVerification(record, [], `workspace snapshot failed: ${errorMessage(error)}`);
    }
    const currentState = stateBinding(this.state?.getHead() ?? null);
    if (!sameBinding(record.state, currentState)) {
      return this.#failedVerification(record, [], "state head changed since hypothesis");
    }
    if (record.generation !== this.#generation()) {
      return this.#failedVerification(record, [], "workspace generation changed since hypothesis");
    }
    if (record.fingerprint !== before.fingerprint) {
      return this.#failedVerification(record, [], "workspace fingerprint changed since hypothesis");
    }

    const results = await this.#verifyEvidence(record.evidence, context);
    let after: WorkspaceSnapshot;
    try {
      after = snapshotWorkspace(this.cwd, [this.mesh.root]);
    } catch (error) {
      return this.#failedVerification(record, results, `post-evidence snapshot failed: ${errorMessage(error)}`);
    }
    const allConfirmed = results.length > 0 && results.every((result) => result.status === "confirmed");
    if (!allConfirmed || before.fingerprint !== after.fingerprint) {
      const reason = before.fingerprint !== after.fingerprint
        ? "workspace fingerprint changed while evidence ran"
        : "one or more evidence items were not confirmed";
      return this.#failedVerification(record, results, reason);
    }

    const certificate = randomBytes(32).toString("hex");
    const issuedAt = Date.now();
    const certificateRecord: SchemaCertificateRecord = {
      tokenHash: hashToken(certificate),
      hypothesisId: record.id,
      parentToolCallId: context.parentToolCallId,
      state: record.state,
      fingerprint: record.fingerprint,
      generation: record.generation,
      issuedAt,
      expiresAt: issuedAt + this.config.certificateTtlMs,
      status: "active",
    };
    const certificateKey = `${CERTIFICATE_PREFIX}${certificateRecord.tokenHash}`;
    await this.mesh.put({
      key: certificateKey,
      value: certificateRecord,
      ifVersion: 0,
      identity: this.identity,
    });
    try {
      await this.mesh.put({
        key: entry.key,
        value: { ...record, status: "verified", updatedAt: Date.now() },
        ifVersion: entry.version,
        identity: this.identity,
      });
    } catch (error) {
      const certificateEntry = this.mesh.get(certificateKey);
      if (certificateEntry) {
        await this.mesh.put({
          key: certificateKey,
          value: { ...certificateRecord, status: "aborted" },
          ifVersion: certificateEntry.version,
          identity: this.identity,
        });
      }
      throw error;
    }
    this.#activeCertificates.set(certificateRecord.tokenHash, context.parentToolCallId);
    try {
      await this.#publish("verified", {
        hypothesisId: record.id,
        tokenHash: certificateRecord.tokenHash,
        results: results.map((result) => ({
          kind: result.evidence.kind,
          status: result.status,
          detail: result.detail,
        })),
        state: record.state,
        fingerprint: record.fingerprint,
        generation: record.generation,
        issuedAt,
        expiresAt: certificateRecord.expiresAt,
      });
    } catch {
      // The certificate and verified hypothesis records are already durable.
    }
    context.update(`Schema evidence confirmed; certificate expires in ${this.config.certificateTtlMs}ms`);
    return {
      verified: true,
      hypothesisId: record.id,
      certificate,
      issuedAt,
      expiresAt: certificateRecord.expiresAt,
      results,
    };
  }

  async commit(
    input: {
      hypothesisId: string;
      certificate: string;
      operations: SchemaFileOperation[];
      postconditions: SchemaEvidence[];
    },
    context: FabricInvocationContext,
  ): Promise<Record<string, unknown>> {
    if (input.operations.length === 0) throw new Error("Schema commit requires at least one file operation");
    if (input.postconditions.length === 0) throw new Error("Schema commit requires nonempty typed postconditions");
    if (input.operations.length > this.config.maxFiles) {
      throw new Error(`Schema transaction exceeds ${this.config.maxFiles} operations`);
    }
    if (input.postconditions.length > this.config.maxFiles) {
      throw new Error(`Schema transaction exceeds ${this.config.maxFiles} postconditions`);
    }
    this.#assertPayloadBound(input);
    const release = this.#acquireCommitLock();
    const transactionId = randomUUID();
    const journalPath = path.join(this.#journalRoot, `${transactionId}.json`);
    let journal: TransactionJournal | undefined;
    let consumed = false;
    let committed = false;
    try {
      const tokenHash = hashToken(input.certificate);
      const certificateEntry = this.mesh.get(`${CERTIFICATE_PREFIX}${tokenHash}`);
      if (!certificateEntry) throw new Error("Unknown Schema certificate");
      const certificate = certificateEntry.value as SchemaCertificateRecord;
      if (certificate.status !== "active") throw new Error(`Schema certificate is ${certificate.status}`);
      if (certificate.hypothesisId !== input.hypothesisId) throw new Error("Schema certificate is bound to a different hypothesis");
      this.#assertInvocation(certificate.parentToolCallId, context.parentToolCallId);
      if (Date.now() > certificate.expiresAt) throw new Error("Schema certificate expired");
      const hypothesisEntry = this.#requireHypothesis(input.hypothesisId);
      const hypothesis = hypothesisEntry.value as SchemaHypothesisRecord;
      if (hypothesis.status !== "verified") throw new Error(`Schema hypothesis is not verified: ${hypothesis.status}`);
      if (!sameBinding(certificate.state, stateBinding(this.state?.getHead() ?? null))) {
        throw new Error("Schema state head changed after verification");
      }
      if (certificate.generation !== this.#generation()) throw new Error("Schema workspace generation is stale");
      const baseline = snapshotWorkspace(this.cwd, [this.mesh.root]);
      if (baseline.fingerprint !== certificate.fingerprint) throw new Error("Schema workspace fingerprint is stale");

      const declared = new Map<string, ReturnType<typeof resolveWorkspaceFile>>();
      let payloadBytes = 0;
      for (const operation of input.operations) {
        const resolved = resolveWorkspaceFile(this.cwd, operationPath(operation), {
          allowAbsent: true,
        });
        if (declared.has(resolved.relative)) {
          throw new Error(`Schema transaction declares a path more than once: ${resolved.relative}`);
        }
        declared.set(resolved.relative, resolved);
        if (operation.kind === "write") payloadBytes += Buffer.byteLength(operation.content);
        if (operation.kind === "edit") payloadBytes += Buffer.byteLength(operation.newText);
      }
      if (declared.size > this.config.maxFiles) throw new Error(`Schema transaction exceeds ${this.config.maxFiles} files`);
      const before: BeforeImage[] = [];
      let beforeBytes = 0;
      for (const resolved of declared.values()) {
        if (!resolved.exists) {
          before.push({ path: resolved.relative, absolute: resolved.absolute, existed: false });
          continue;
        }
        const content = fs.readFileSync(resolved.absolute);
        beforeBytes += content.byteLength;
        before.push({
          path: resolved.relative,
          absolute: resolved.absolute,
          existed: true,
          content: content.toString("base64"),
          mode: fs.statSync(resolved.absolute).mode & 0o777,
        });
      }
      if (payloadBytes + beforeBytes > this.config.maxBytes) {
        throw new Error(`Schema transaction exceeds ${this.config.maxBytes} bytes`);
      }
      const staged = this.#planOperations(
        input.operations,
        declared,
        transactionId,
        context.signal,
      );
      for (let index = 0; index < staged.length; index++) {
        const image = before[index]!;
        const sourceDigest = image.existed
          ? `sha256:${createHash("sha256").update(Buffer.from(image.content!, "base64")).digest("hex")}`
          : null;
        if (sourceDigest !== staged[index]!.sourceSha256) {
          throw new Error(`Schema workspace drifted while preparing before image: ${image.path}`);
        }
      }
      const relative = (absolute: string): string =>
        path.relative(this.cwd, absolute).split(path.sep).join("/");
      const journalOperations: JournalOperation[] = staged.map((operation) => ({
        path: operation.path,
        kind: operation.operation.kind,
        sourceSha256: operation.sourceSha256,
        ...(operation.resultSha256 ? { resultSha256: operation.resultSha256 } : {}),
        ...(operation.temporary ? { temporary: relative(operation.temporary) } : {}),
        ...(operation.backup ? { backup: relative(operation.backup) } : {}),
        ...(operation.rollbackClaim ? { rollbackClaim: relative(operation.rollbackClaim) } : {}),
        ...(operation.restoreTemporary
          ? {
              restoreTemporary: relative(operation.restoreTemporary),
              restoreSha256: operation.restoreSha256,
            }
          : {}),
      }));
      const stagedPaths = journalOperations.flatMap((operation) => [
        operation.temporary,
        operation.backup,
        operation.rollbackClaim,
        operation.restoreTemporary,
      ].filter((value): value is string => value !== undefined));
      journal = {
        format: 3,
        id: transactionId,
        status: "prepared",
        before,
        staged: stagedPaths,
        operations: journalOperations,
        createdAt: Date.now(),
      };
      // Every possible result, before-file, rollback claim, and restore stage,
      // together with its ownership digest, is durable before one is created.
      atomicJsonWrite(journalPath, journal);

      this.#assertCommitActive(context.signal);
      await this.mesh.put({
        key: certificateEntry.key,
        value: { ...certificate, status: "consumed", consumedAt: Date.now() },
        ifVersion: certificateEntry.version,
        identity: this.identity,
      });
      consumed = true;
      const afterConsume = snapshotWorkspace(this.cwd, [this.mesh.root]);
      if (afterConsume.fingerprint !== certificate.fingerprint) {
        throw new Error("Schema workspace drifted while consuming the certificate");
      }

      this.#writeStagedResults(staged, context.signal);
      this.#assertCommitActive(context.signal);
      for (const operation of staged) this.#assertSourceUnchanged(operation);
      journal.status = "applying";
      atomicJsonWrite(journalPath, journal);
      for (const operation of staged) {
        this.#assertCommitActive(context.signal);
        this.#commitStagedOperation(operation);
      }
      for (const operation of staged) this.#assertStagedResult(operation);
      const applied = snapshotWorkspace(this.cwd, [this.mesh.root]);
      this.#assertNoOutsideDrift(
        baseline,
        applied,
        new Set([...declared.keys(), ...(journal.staged ?? [])]),
      );
      const postconditionResults = await this.#verifyEvidence(input.postconditions, context);
      this.#assertCommitActive(context.signal);
      const afterPostconditions = snapshotWorkspace(this.cwd, [this.mesh.root]);
      if (applied.fingerprint !== afterPostconditions.fingerprint) {
        throw new Error("Schema workspace changed while postconditions ran");
      }
      if (!postconditionResults.every((result) => result.status === "confirmed")) {
        throw new Error("Schema commit postconditions were not all confirmed");
      }

      const workspaceEntry = this.#workspaceEntry();
      const nextGeneration = certificate.generation + 1;
      await this.mesh.put({
        key: WORKSPACE_KEY,
        value: {
          generation: nextGeneration,
          lastOutcome: "committed",
          lastTransactionId: transactionId,
          updatedAt: Date.now(),
        } satisfies SchemaWorkspaceRecord,
        ifVersion: workspaceEntry?.version ?? 0,
        identity: this.identity,
      });
      committed = true;
      journal.status = "committed";
      try {
        atomicJsonWrite(journalPath, journal);
      } catch {
        // Recovery cross-checks the authoritative committed workspace record.
      }
      const committedCleanupError = this.#cleanupStaged(journal);
      if (committedCleanupError) {
        journal.status = "quarantined";
        journal.error = `committed workspace staging cleanup failed: ${committedCleanupError}`;
        try {
          atomicJsonWrite(journalPath, journal);
        } catch {
          // The committed workspace record remains authoritative. Suspicious
          // artifacts stay in place even if this diagnostic write also fails.
        }
      }

      let stateTransition: unknown = null;
      try {
        stateTransition = this.state
          ? await this.state.transition(
              {
                label: `schema:${hypothesis.label}`,
                ...(certificate.state ? { from: certificate.state.to } : {}),
                to: `schema-commit-${nextGeneration}`,
                summary: hypothesis.summary,
              },
              this.identity,
              this.cwd,
            )
          : null;
      } catch (error) {
        stateTransition = { error: errorMessage(error) };
      }
      try {
        await this.mesh.put({
          key: hypothesisEntry.key,
          value: { ...hypothesis, status: "committed", updatedAt: Date.now() },
          ifVersion: hypothesisEntry.version,
          identity: this.identity,
        });
      } catch {
        // The committed workspace generation and outcome remain authoritative.
      }
      try {
        await this.#publish("committed", {
          transactionId,
          hypothesisId: hypothesis.id,
          generation: nextGeneration,
          paths: [...declared.keys()],
          postconditions: postconditionResults.map((result) => ({
            kind: result.evidence.kind,
            status: result.status,
            detail: result.detail,
          })),
          complexityReductionCertified: hypothesis.complexityReduction,
          stateTransition,
        });
      } catch {
        // schema/workspace is the authoritative durable committed outcome.
      }
      this.#activeHypotheses.delete(hypothesis.id);
      this.#activeCertificates.delete(tokenHash);
      context.update(`Schema transaction committed at generation ${nextGeneration}`);
      return {
        outcome: "committed",
        transactionId,
        generation: nextGeneration,
        paths: [...declared.keys()],
        postconditions: postconditionResults,
        complexityReductionCertified: hypothesis.complexityReduction,
        stateTransition,
      };
    } catch (error) {
      if (!consumed) {
        if (journal) {
          const cleanupError = this.#cleanupStaged(journal);
          journal.status = cleanupError ? "quarantined" : "rolled_back";
          journal.error = cleanupError
            ? `${errorMessage(error)}; cleanup refused: ${cleanupError}`
            : errorMessage(error);
          try {
            atomicJsonWrite(journalPath, journal);
          } catch {
            // No workspace mutation occurred; a prepared journal is recoverable.
          }
        }
        throw error;
      }
      if (committed) throw error;
      // A prepared transaction has not published any workspace operation. Only
      // clean its stages: restoring before images here would overwrite the very
      // external source drift that caused refusal.
      const restoreError = journal?.status === "applying"
        ? this.#rollbackPublished(journal)
        : undefined;
      const cleanupError = journal ? this.#cleanupStaged(journal) : undefined;
      const rollbackError = [restoreError, cleanupError].filter(Boolean).join("; ") || undefined;
      const outcome = rollbackError ? "quarantined" : "rolled_back";
      if (journal) {
        journal.status = outcome;
        journal.error = rollbackError
          ? `${errorMessage(error)}; rollback failed: ${rollbackError}`
          : errorMessage(error);
        try {
          atomicJsonWrite(journalPath, journal);
        } catch {
          // The mesh outcome record below remains the durable fallback.
        }
      }
      await this.#recordFailedOutcome(outcome, transactionId, errorMessage(error), rollbackError);
      context.update(`Schema transaction ${outcome}`);
      return {
        outcome,
        transactionId,
        error: errorMessage(error),
        ...(rollbackError ? { rollbackError } : {}),
      };
    } finally {
      release();
    }
  }

  async abort(
    input: { hypothesisId: string; certificate?: string },
    context: FabricInvocationContext,
  ): Promise<Record<string, unknown>> {
    const hypothesisEntry = this.#requireHypothesis(input.hypothesisId);
    const hypothesis = hypothesisEntry.value as SchemaHypothesisRecord;
    this.#assertInvocation(hypothesis.parentToolCallId, context.parentToolCallId);
    if (hypothesis.status === "committed") throw new Error("Committed Schema hypotheses cannot be aborted");
    if (input.certificate) {
      const tokenHash = hashToken(input.certificate);
      const certificateEntry = this.mesh.get(`${CERTIFICATE_PREFIX}${tokenHash}`);
      if (!certificateEntry) throw new Error("Unknown Schema certificate");
      const certificate = certificateEntry.value as SchemaCertificateRecord;
      this.#assertInvocation(certificate.parentToolCallId, context.parentToolCallId);
      if (certificate.status !== "active") throw new Error(`Schema certificate is ${certificate.status}`);
      await this.mesh.put({
        key: certificateEntry.key,
        value: { ...certificate, status: "aborted" },
        ifVersion: certificateEntry.version,
        identity: this.identity,
      });
      this.#activeCertificates.delete(tokenHash);
    }
    await this.mesh.put({
      key: hypothesisEntry.key,
      value: { ...hypothesis, status: "aborted", updatedAt: Date.now() },
      ifVersion: hypothesisEntry.version,
      identity: this.identity,
    });
    this.#activeHypotheses.delete(hypothesis.id);
    await this.#publish("aborted", { hypothesisId: hypothesis.id, parentToolCallId: context.parentToolCallId });
    return { aborted: true, hypothesisId: hypothesis.id };
  }

  async endInvocation(parentToolCallId: string): Promise<void> {
    for (const [tokenHash, invocation] of [...this.#activeCertificates]) {
      if (invocation !== parentToolCallId) continue;
      const entry = this.mesh.get(`${CERTIFICATE_PREFIX}${tokenHash}`);
      if (entry) {
        const record = entry.value as SchemaCertificateRecord;
        if (record.status === "active") {
          try {
            await this.mesh.put({
              key: entry.key,
              value: { ...record, status: "abandoned" },
              ifVersion: entry.version,
              identity: this.identity,
            });
          } catch {
            // A concurrent consume wins; the certificate is no longer active.
          }
        }
      }
      this.#activeCertificates.delete(tokenHash);
    }
    for (const [hypothesisId, invocation] of [...this.#activeHypotheses]) {
      if (invocation !== parentToolCallId) continue;
      const entry = this.mesh.get(`${HYPOTHESIS_PREFIX}${hypothesisId}`);
      if (entry) {
        const record = entry.value as SchemaHypothesisRecord;
        if (record.status === "active" || record.status === "verified") {
          try {
            await this.mesh.put({
              key: entry.key,
              value: { ...record, status: "abandoned", updatedAt: Date.now() },
              ifVersion: entry.version,
              identity: this.identity,
            });
          } catch {
            // A concurrent terminal transition wins.
          }
        }
      }
      this.#activeHypotheses.delete(hypothesisId);
    }
  }

  async #failedVerification(
    record: SchemaHypothesisRecord,
    results: SchemaEvidenceResult[],
    reason: string,
  ): Promise<Record<string, unknown>> {
    try {
      await this.#publish("verification_failed", {
        hypothesisId: record.id,
        reason,
        results: results.map((result) => ({ kind: result.evidence.kind, status: result.status, detail: result.detail })),
      });
    } catch {
      // Returning the fail-closed result must not depend on audit capacity.
    }
    return { verified: false, hypothesisId: record.id, reason, results };
  }

  async #verifyEvidence(
    evidence: SchemaEvidence[],
    context: FabricInvocationContext,
  ): Promise<SchemaEvidenceResult[]> {
    if (evidence.length === 0) return [];
    const results: SchemaEvidenceResult[] = [];
    for (const item of evidence) {
      if (context.signal?.aborted) {
        results.push({ evidence: item, status: "error", detail: "cancelled" });
        continue;
      }
      try {
        if (item.kind === "trusted_command") {
          const command = this.config.trustedCommands[item.name];
          if (!command) {
            results.push({ evidence: item, status: "nonconfirmed", detail: `trusted command is not configured: ${item.name}` });
          } else {
            results.push(await this.#runTrustedCommand(item, command, context.signal));
          }
          continue;
        }
        const resolved = resolveWorkspaceFile(this.cwd, item.path, {
          allowAbsent: item.kind === "file_absent",
        });
        if (item.kind === "file_absent") {
          results.push({
            evidence: item,
            status: resolved.exists ? "nonconfirmed" : "confirmed",
            detail: resolved.exists ? "file exists" : "file is absent",
          });
        } else if (item.kind === "file_exists") {
          results.push({
            evidence: item,
            status: "confirmed",
            detail: "file exists",
            observedSha256: sha256File(resolved.absolute),
          });
        } else if (item.kind === "file_contains") {
          const confirmed = fs.readFileSync(resolved.absolute, "utf8").includes(item.literal);
          results.push({
            evidence: item,
            status: confirmed ? "confirmed" : "nonconfirmed",
            detail: confirmed ? "literal found" : "literal not found",
            observedSha256: sha256File(resolved.absolute),
          });
        } else {
          const actual = sha256File(resolved.absolute);
          results.push({
            evidence: item,
            status: actual === item.sha256 ? "confirmed" : "nonconfirmed",
            detail: actual,
            observedSha256: actual,
          });
        }
      } catch (error) {
        results.push({ evidence: item, status: "error", detail: errorMessage(error) });
      }
    }
    return results;
  }

  #runTrustedCommand(
    evidence: Extract<SchemaEvidence, { kind: "trusted_command" }>,
    command: FabricSchemaTrustedCommand,
    signal?: AbortSignal,
  ): Promise<SchemaEvidenceResult> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      const finish = (status: SchemaEvidenceResult["status"], detail: string, exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ evidence, status, detail, exitCode, output });
      };
      let child;
      try {
        child = spawn(command.command, command.shell ? [] : command.args, {
          cwd: this.cwd,
          shell: command.shell,
          stdio: ["ignore", "pipe", "pipe"],
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        resolve({ evidence, status: "error", detail: errorMessage(error), exitCode: null });
        return;
      }
      const append = (chunk: Buffer): void => {
        if (output.length < OUTPUT_LIMIT) output += chunk.toString().slice(0, OUTPUT_LIMIT - output.length);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => finish("error", error.message, null));
      child.on("close", (code) => {
        const exitCode = typeof code === "number" ? code : null;
        finish(exitCode === 0 ? "confirmed" : exitCode === null ? "error" : "nonconfirmed", exitCode === 0 ? "exit 0" : `exit ${exitCode ?? "signal"}`, exitCode);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish("error", `timeout after ${command.timeoutMs}ms`, null);
      }, command.timeoutMs);
      timer.unref?.();
    });
  }

  #stagingPath(
    resolved: ReturnType<typeof resolveWorkspaceFile>,
    transactionId: string,
    index: number,
  ): { absolute: string; relative: string } {
    const temporary = path.join(
      path.dirname(resolved.absolute),
      `.${path.basename(resolved.absolute)}.schema-${transactionId}-${index}.tmp`,
    );
    return {
      absolute: temporary,
      relative: path.relative(this.cwd, temporary).split(path.sep).join("/"),
    };
  }

  #backupPath(
    resolved: ReturnType<typeof resolveWorkspaceFile>,
    transactionId: string,
    index: number,
  ): { absolute: string; relative: string } {
    const backup = path.join(
      path.dirname(resolved.absolute),
      `.${path.basename(resolved.absolute)}.schema-${transactionId}-${index}.before`,
    );
    return {
      absolute: backup,
      relative: path.relative(this.cwd, backup).split(path.sep).join("/"),
    };
  }

  #rollbackClaimPath(
    resolved: ReturnType<typeof resolveWorkspaceFile>,
    transactionId: string,
    index: number,
  ): { absolute: string; relative: string } {
    const claim = path.join(
      path.dirname(resolved.absolute),
      `.${path.basename(resolved.absolute)}.schema-${transactionId}-${index}.rollback`,
    );
    return {
      absolute: claim,
      relative: path.relative(this.cwd, claim).split(path.sep).join("/"),
    };
  }

  #restorePath(
    resolved: ReturnType<typeof resolveWorkspaceFile>,
    transactionId: string,
    index: number,
  ): { absolute: string; relative: string } {
    const temporary = `${resolved.absolute}.schema-${transactionId}-${index}.restore.tmp`;
    return {
      absolute: temporary,
      relative: path.relative(this.cwd, temporary).split(path.sep).join("/"),
    };
  }

  #planOperations(
    operations: SchemaFileOperation[],
    declared: Map<string, ReturnType<typeof resolveWorkspaceFile>>,
    transactionId: string,
    signal?: AbortSignal,
  ): StagedOperation[] {
    const staged: StagedOperation[] = [];
    for (let index = 0; index < operations.length; index++) {
      this.#assertCommitActive(signal);
      const operation = operations[index]!;
      const current = resolveWorkspaceFile(this.cwd, operation.path, {
        allowAbsent: operation.kind === "write",
      });
      const declaredPath = declared.get(current.relative);
      if (!declaredPath) throw new Error(`Schema transaction path resolution failed: ${operation.path}`);
      const sourceBytes = current.exists ? fs.readFileSync(current.absolute) : undefined;
      const sourceSha256 = sourceBytes
        ? `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`
        : null;
      let next: Buffer | undefined;
      if (operation.kind === "write") {
        next = Buffer.from(operation.content, "utf8");
      } else if (operation.kind === "edit") {
        const content = sourceBytes!.toString("utf8");
        const first = content.indexOf(operation.oldText);
        next = first >= 0 && content.indexOf(operation.oldText, first + operation.oldText.length) < 0
          ? Buffer.from(
              `${content.slice(0, first)}${operation.newText}${content.slice(first + operation.oldText.length)}`,
              "utf8",
            )
          : sourceBytes;
      }
      const item: StagedOperation = {
        operation,
        path: current.relative,
        absolute: current.absolute,
        sourceSha256,
        ...(current.exists
          ? {
              backup: this.#backupPath(current, transactionId, index).absolute,
              restoreTemporary: this.#restorePath(current, transactionId, index).absolute,
              restoreSha256: sourceSha256!,
            }
          : {}),
        ...(next
          ? {
              temporary: this.#stagingPath(current, transactionId, index).absolute,
              resultSha256: `sha256:${createHash("sha256").update(next).digest("hex")}`,
              rollbackClaim: this.#rollbackClaimPath(current, transactionId, index).absolute,
            }
          : {}),
      };
      staged.push(item);
    }
    return staged;
  }

  #writeStagedResults(staged: StagedOperation[], signal?: AbortSignal): void {
    for (const item of staged) {
      this.#assertCommitActive(signal);
      const operation = item.operation;
      if (operation.kind === "write") {
        if ("absent" in operation.expected) {
          if (item.sourceSha256 !== null) {
            throw new Error(`Schema precondition failed; expected absent: ${operation.path}`);
          }
        } else if (item.sourceSha256 !== operation.expected.sha256) {
          throw new Error(`Schema precondition SHA-256 mismatch: ${operation.path}`);
        }
      } else if (item.sourceSha256 !== operation.expectedSha256) {
        throw new Error(`Schema precondition SHA-256 mismatch: ${operation.path}`);
      }
      if (!item.temporary || operation.kind === "delete") continue;
      const next = operation.kind === "write"
        ? Buffer.from(operation.content, "utf8")
        : (() => {
            const source = fs.readFileSync(item.absolute, "utf8");
            const first = source.indexOf(operation.oldText);
            if (first < 0 || source.indexOf(operation.oldText, first + operation.oldText.length) >= 0) {
              throw new Error(`Schema edit requires oldText to occur exactly once: ${operation.path}`);
            }
            return Buffer.from(
              `${source.slice(0, first)}${operation.newText}${source.slice(first + operation.oldText.length)}`,
              "utf8",
            );
          })();
      if (`sha256:${createHash("sha256").update(next).digest("hex")}` !== item.resultSha256) {
        throw new Error(`Schema source changed while staging: ${item.path}`);
      }
      const mode = item.sourceSha256 !== null ? fs.statSync(item.absolute).mode & 0o777 : 0o600;
      let descriptor: number | undefined;
      try {
        descriptor = fs.openSync(item.temporary, "wx", mode);
        fs.writeFileSync(descriptor, next);
        fs.fsyncSync(descriptor);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
      fsyncDirectory(path.dirname(item.temporary));
    }
  }

  #assertSourceUnchanged(staged: StagedOperation): void {
    const current = resolveWorkspaceFile(this.cwd, staged.path, { allowAbsent: true });
    const actual = current.exists ? sha256File(current.absolute) : null;
    if (actual !== staged.sourceSha256) {
      throw new Error(`Schema source SHA-256 drift detected before commit: ${staged.path}`);
    }
  }

  #commitStagedOperation(staged: StagedOperation): void {
    const parent = path.dirname(staged.absolute);
    if (staged.sourceSha256 !== null) {
      if (!staged.backup) throw new Error(`Schema before-file path is missing: ${staged.path}`);
      // Atomically claim the exact source name first, then hash the claimed
      // inode. A cooperative writer can no longer be overwritten between the
      // final hash check and publication.
      fs.renameSync(staged.absolute, staged.backup);
      fsyncDirectory(parent);
      const claimed = sha256File(staged.backup);
      if (claimed !== staged.sourceSha256) {
        try {
          fs.linkSync(staged.backup, staged.absolute);
          fs.unlinkSync(staged.backup);
          fsyncFile(staged.absolute);
          fsyncDirectory(parent);
        } catch {
          // The unexpected claimed file remains in its recorded backup path.
        }
        throw new Error(`Schema source SHA-256 drift detected while claiming: ${staged.path}`);
      }
    } else if (fs.existsSync(staged.absolute)) {
      throw new Error(`Schema source appeared before commit: ${staged.path}`);
    }

    if (staged.operation.kind !== "delete") {
      if (!staged.temporary) throw new Error(`Schema staging file is missing: ${staged.path}`);
      // link(2) is an atomic no-replace publish. Unlike rename-over-target it
      // cannot erase content that appeared after the source was claimed.
      fs.linkSync(staged.temporary, staged.absolute);
      fs.unlinkSync(staged.temporary);
      fsyncFile(staged.absolute);
    }
    fsyncDirectory(parent);
  }

  #assertStagedResult(staged: StagedOperation): void {
    const current = resolveWorkspaceFile(this.cwd, staged.path, { allowAbsent: true });
    if (staged.operation.kind === "delete") {
      if (current.exists) throw new Error(`Schema staged delete did not commit: ${staged.path}`);
      return;
    }
    if (!current.exists || sha256File(current.absolute) !== staged.resultSha256) {
      throw new Error(`Schema staged write did not commit atomically: ${staged.path}`);
    }
  }

  #assertCommitActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Schema commit cancelled");
  }

  #assertNoOutsideDrift(before: WorkspaceSnapshot, after: WorkspaceSnapshot, declared: Set<string>): void {
    if (before.git !== after.git || before.head !== after.head || before.indexDigest !== after.indexDigest) {
      throw new Error("Schema detected Git HEAD or index drift during commit");
    }
    const paths = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]);
    for (const file of paths) {
      if (declared.has(file)) continue;
      if (before.entries[file] !== after.entries[file]) {
        throw new Error(`Schema detected undeclared workspace drift: ${file}`);
      }
    }
  }

  #regularFileDigest(filePath: string): string {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unexpected non-regular content");
    return sha256File(filePath);
  }

  #publishBeforeImage(image: BeforeImage, operation: JournalOperation): void {
    if (!image.existed) return;
    if (!operation.restoreTemporary || !operation.restoreSha256) {
      throw new Error("restore staging ownership is missing");
    }
    const temporary = resolveWorkspaceFile(this.cwd, operation.restoreTemporary, {
      allowAbsent: true,
    }).absolute;
    const parent = path.dirname(image.absolute);
    const bytes = Buffer.from(image.content ?? "", "base64");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== operation.restoreSha256 || digest !== operation.sourceSha256) {
      throw new Error("before-image restore digest is malformed");
    }
    if (fs.existsSync(temporary)) {
      if (this.#regularFileDigest(temporary) !== digest) {
        throw new Error("restore staging contains unexpected concurrent bytes");
      }
    } else {
      let descriptor: number | undefined;
      try {
        descriptor = fs.openSync(temporary, "wx", image.mode ?? 0o600);
        fs.writeFileSync(descriptor, bytes);
        if (image.mode !== undefined) fs.fchmodSync(descriptor, image.mode);
        fs.fsyncSync(descriptor);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
      fsyncDirectory(parent);
    }
    fs.linkSync(temporary, image.absolute);
    fs.unlinkSync(temporary);
    fsyncFile(image.absolute);
    fsyncDirectory(parent);
  }

  #restoreClaim(claim: string, target: string): void {
    fs.linkSync(claim, target);
    fs.unlinkSync(claim);
    fsyncFile(target);
    fsyncDirectory(path.dirname(target));
  }

  #rollbackPublished(journal: TransactionJournal): string | undefined {
    const errors: string[] = [];
    const images = new Map(journal.before.map((image) => [image.path, image]));
    for (const operation of [...journal.operations].reverse()) {
      const image = images.get(operation.path);
      if (!image) {
        errors.push(`${operation.path}: missing before image`);
        continue;
      }
      const claim = operation.rollbackClaim
        ? resolveWorkspaceFile(this.cwd, operation.rollbackClaim, { allowAbsent: true }).absolute
        : undefined;
      try {
        const resolved = resolveWorkspaceFile(this.cwd, operation.path, { allowAbsent: true });
        if (resolved.exists) {
          const currentDigest = this.#regularFileDigest(resolved.absolute);
          if (image.existed && currentDigest === operation.sourceSha256) {
            // Recovery may resume after the restore link was published but
            // before its claim or restore stage was cleaned.
            continue;
          }
          if (operation.kind !== "delete" && operation.resultSha256 && claim) {
            if (fs.existsSync(claim)) {
              errors.push(`${operation.path}: rollback claim already exists beside destination; artifacts preserved`);
              continue;
            }
            fs.renameSync(resolved.absolute, claim);
            fsyncDirectory(path.dirname(resolved.absolute));
            const digest = this.#regularFileDigest(claim);
            if (digest === operation.resultSha256) {
              if (image.existed) this.#publishBeforeImage(image, operation);
              if (!image.existed && fs.existsSync(resolved.absolute)) {
                errors.push(`${operation.path}: unexpected concurrent content appeared during rollback`);
              }
              continue;
            }
            this.#restoreClaim(claim, resolved.absolute);
            errors.push(`${operation.path}: unexpected concurrent content; rollback refused`);
            continue;
          }
          if (currentDigest !== operation.sourceSha256) {
            errors.push(`${operation.path}: unexpected concurrent content; rollback refused`);
          }
          continue;
        }

        if (claim && fs.existsSync(claim)) {
          const claimedDigest = this.#regularFileDigest(claim);
          if (claimedDigest !== operation.resultSha256) {
            errors.push(`${operation.path}: rollback claim contains unexpected concurrent bytes; artifact preserved`);
            continue;
          }
          if (image.existed) this.#publishBeforeImage(image, operation);
          continue;
        }
        const backupPath = operation.backup
          ? resolveWorkspaceFile(this.cwd, operation.backup, { allowAbsent: true })
          : undefined;
        if (backupPath?.exists && this.#regularFileDigest(backupPath.absolute) === operation.sourceSha256) {
          this.#publishBeforeImage(image, operation);
          continue;
        }
        if (operation.sourceSha256 !== null) {
          errors.push(`${operation.path}: source disappeared without an owned before-file; rollback refused`);
        }
      } catch (error) {
        // A failed no-replace restoration deliberately leaves every recorded
        // artifact for operator inspection and never overwrites the winner.
        errors.push(`${operation.path}: ${errorMessage(error)}`);
        if (claim && fs.existsSync(claim) && !fs.existsSync(image.absolute)) {
          try { this.#restoreClaim(claim, image.absolute); } catch { /* retain claim */ }
        }
      }
    }
    return errors.length > 0 ? errors.join("; ") : undefined;
  }

  #cleanupStaged(journal: TransactionJournal): string | undefined {
    const errors: string[] = [];
    const expectedDigests = new Map<string, string>();
    for (const operation of journal.operations ?? []) {
      if (operation.temporary && operation.resultSha256) {
        expectedDigests.set(operation.temporary, operation.resultSha256);
      }
      if (operation.backup && operation.sourceSha256) {
        expectedDigests.set(operation.backup, operation.sourceSha256);
      }
      if (operation.rollbackClaim && operation.resultSha256) {
        expectedDigests.set(operation.rollbackClaim, operation.resultSha256);
      }
      if (operation.restoreTemporary && operation.restoreSha256) {
        expectedDigests.set(operation.restoreTemporary, operation.restoreSha256);
      }
    }
    for (const stagedPath of journal.staged ?? []) {
      try {
        const resolved = resolveWorkspaceFile(this.cwd, stagedPath, { allowAbsent: true });
        if (!resolved.exists) continue;
        const expectedDigest = expectedDigests.get(stagedPath);
        if (!expectedDigest) {
          errors.push(`${stagedPath}: ownership bytes are unrecorded; artifact preserved`);
          continue;
        }
        const actualDigest = this.#regularFileDigest(resolved.absolute);
        if (actualDigest !== expectedDigest) {
          errors.push(`${stagedPath}: unexpected concurrent bytes; artifact preserved`);
          continue;
        }
        fs.unlinkSync(resolved.absolute);
        fsyncDirectory(path.dirname(resolved.absolute));
      } catch (error) {
        errors.push(`${stagedPath}: ${errorMessage(error)}`);
      }
    }
    return errors.length > 0 ? `staging cleanup failed: ${errors.join("; ")}` : undefined;
  }

  async #recordFailedOutcome(
    outcome: "rolled_back" | "quarantined",
    transactionId: string,
    error: string,
    rollbackError?: string,
  ): Promise<void> {
    try {
      const entry = this.#workspaceEntry();
      await this.mesh.put({
        key: WORKSPACE_KEY,
        value: {
          generation: (entry?.value as SchemaWorkspaceRecord | undefined)?.generation ?? 0,
          lastOutcome: outcome,
          lastTransactionId: transactionId,
          updatedAt: Date.now(),
        } satisfies SchemaWorkspaceRecord,
        ifVersion: entry?.version ?? 0,
        identity: this.identity,
      });
      await this.#publish(outcome, { transactionId, error, ...(rollbackError ? { rollbackError } : {}) });
    } catch {
      // The journal is the durable fallback when mesh outcome recording fails.
    }
  }

  #generation(): number {
    return (this.#workspaceEntry()?.value as SchemaWorkspaceRecord | undefined)?.generation ?? 0;
  }

  #workspaceEntry(): MeshStateEntry | undefined {
    return this.mesh.get(WORKSPACE_KEY);
  }

  #requireHypothesis(id: string): MeshStateEntry {
    const entry = this.mesh.get(`${HYPOTHESIS_PREFIX}${id}`);
    if (!entry) throw new Error(`Unknown Schema hypothesis: ${id}`);
    return entry;
  }

  #assertInvocation(expected: string, actual: string): void {
    if (expected !== actual) throw new Error("Schema artifact belongs to a different fabric_exec invocation");
  }

  #assertPayloadBound(value: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > this.config.maxBytes) throw new Error(`Schema request exceeds ${this.config.maxBytes} bytes`);
  }

  #publish(kind: string, data: unknown): Promise<unknown> {
    return this.mesh.publish({ topic: SCHEMA_TOPIC, kind, from: this.identity, data });
  }

  #readLockOwner(filePath = this.#lockPath): CommitLockOwner | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<CommitLockOwner>;
      if (
        (value.format !== 1 && value.format !== 2) ||
        typeof value.nonce !== "string" ||
        !/^[a-f0-9]{32}$/.test(value.nonce) ||
        !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
        !Number.isSafeInteger(value.createdAt) ||
        (value.bootId !== undefined && typeof value.bootId !== "string") ||
        (value.processStart !== undefined && typeof value.processStart !== "string")
      ) return undefined;
      return value as CommitLockOwner;
    } catch {
      return undefined;
    }
  }

  #ownerIsAlive(owner: CommitLockOwner): boolean {
    return processInstanceIsAlive(owner);
  }

  #tryAcquireCanonicalLock(): (() => void) | undefined {
    fs.mkdirSync(this.#journalRoot, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(16).toString("hex");
    const ownerPath = path.join(this.#journalRoot, `.commit.owner-${nonce}.json`);
    const owner: CommitLockOwner = {
      format: 2,
      nonce,
      createdAt: Date.now(),
      ...processInstanceIdentity(),
    };
    const descriptor = fs.openSync(ownerPath, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fsyncDirectory(this.#journalRoot);

    try {
      // The fixed lock appears as one atomic hard link to an already-complete,
      // fsynced owner record. Nobody can observe a partially written owner.
      fs.linkSync(ownerPath, this.#lockPath);
      fsyncDirectory(this.#journalRoot);
    } catch (error) {
      fs.rmSync(ownerPath, { force: true });
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return undefined;
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        const current = this.#readLockOwner();
        if (current?.nonce === nonce) {
          const lockStat = fs.lstatSync(this.#lockPath);
          const ownerStat = fs.lstatSync(ownerPath);
          if (
            lockStat.isFile() && !lockStat.isSymbolicLink() &&
            ownerStat.isFile() && !ownerStat.isSymbolicLink() &&
            lockStat.dev === ownerStat.dev && lockStat.ino === ownerStat.ino
          ) {
            fs.unlinkSync(this.#lockPath);
          }
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      } finally {
        fs.rmSync(ownerPath, { force: true });
        fsyncDirectory(this.#journalRoot);
      }
    };
  }

  #acquireCommitLock(): () => void {
    let release = this.#tryAcquireCanonicalLock();
    if (!release) {
      // Recovery owns the same canonical exclusion boundary. It either finishes
      // and releases a stale lock, or leaves a live/foreign lock untouched.
      if (!this.#recoverJournals()) throw new Error("Another Schema transaction is in progress");
      release = this.#tryAcquireCanonicalLock();
      if (!release) throw new Error("Another Schema transaction is in progress");
    }
    try {
      // A process may have crashed before this controller was constructed. Scan
      // while retaining our canonical lock before starting a new transaction.
      this.#recoverJournalsLocked();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  #recoverJournals(): boolean {
    fs.mkdirSync(this.#journalRoot, { recursive: true, mode: 0o700 });
    const release = this.#tryAcquireCanonicalLock();
    if (release) {
      try {
        this.#recoverJournalsLocked();
        return true;
      } finally {
        release();
      }
    }

    const owner = this.#readLockOwner();
    if (!owner || this.#ownerIsAlive(owner)) return false;
    const ownerPath = path.join(this.#journalRoot, `.commit.owner-${owner.nonce}.json`);
    let lockStat: fs.Stats;
    try {
      lockStat = fs.lstatSync(this.#lockPath);
      const ownerStat = fs.lstatSync(ownerPath);
      // Valid-looking bytes are insufficient authority to steal a lock. The
      // canonical name must still be the hard link to its recorded owner file.
      if (
        !lockStat.isFile() || lockStat.isSymbolicLink() ||
        !ownerStat.isFile() || ownerStat.isSymbolicLink() ||
        lockStat.dev !== ownerStat.dev || lockStat.ino !== ownerStat.ino
      ) return false;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }

    const recoveryMarker = path.join(this.#journalRoot, `.commit.recovery-${owner.nonce}`);
    try {
      // This hard link is the atomic stale-recovery claim. Crucially, the fixed
      // canonical lock remains linked for the complete recovery; no successor
      // can enter while journals are scanned, rolled back, cleaned, or written.
      fs.linkSync(this.#lockPath, recoveryMarker);
      fsyncDirectory(this.#journalRoot);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
      throw error;
    }

    let claimed = false;
    try {
      const currentLock = fs.lstatSync(this.#lockPath);
      const markerStat = fs.lstatSync(recoveryMarker);
      const currentOwner = fs.lstatSync(ownerPath);
      if (
        currentLock.dev !== lockStat.dev || currentLock.ino !== lockStat.ino ||
        markerStat.dev !== lockStat.dev || markerStat.ino !== lockStat.ino ||
        currentOwner.dev !== lockStat.dev || currentOwner.ino !== lockStat.ino
      ) return false;
      claimed = true;
      this.#recoverJournalsLocked();
      return true;
    } finally {
      // Because the canonical name was never removed during recovery, this
      // conditional release cannot race with and unlink a successor's lock.
      if (claimed) {
        try {
          const current = fs.lstatSync(this.#lockPath);
          if (current.dev === lockStat.dev && current.ino === lockStat.ino) {
            fs.unlinkSync(this.#lockPath);
          }
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      try {
        const marker = fs.lstatSync(recoveryMarker);
        if (marker.dev === lockStat.dev && marker.ino === lockStat.ino) fs.unlinkSync(recoveryMarker);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (claimed) {
        try {
          const currentOwner = fs.lstatSync(ownerPath);
          if (currentOwner.dev === lockStat.dev && currentOwner.ino === lockStat.ino) fs.unlinkSync(ownerPath);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      fsyncDirectory(this.#journalRoot);
    }
  }

  #readRecoveryJournal(filePath: string, name: string): TransactionJournal | undefined {
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Schema transaction recovery blocked by malformed journal ${name}: ${errorMessage(error)}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Schema transaction recovery blocked by malformed journal ${name}`);
    }
    const candidate = value as Record<string, unknown>;
    const status = candidate.status;
    const terminal = status === "committed" || status === "rolled_back";
    // Resolved journals from the previous protocol are retained for audit but
    // never used to claim or remove artifacts under the stricter protocol.
    if (candidate.format === 2 && terminal) return undefined;
    if (candidate.format !== 3) {
      throw new Error(`Schema transaction recovery blocked by unsupported journal ${name}`);
    }
    if (
      typeof candidate.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,128}$/u.test(candidate.id) ||
      name !== `${candidate.id}.json` ||
      !["prepared", "applying", "committed", "rolled_back", "quarantined"].includes(String(status)) ||
      !Number.isSafeInteger(candidate.createdAt) ||
      !Array.isArray(candidate.before) ||
      !Array.isArray(candidate.operations) ||
      !Array.isArray(candidate.staged)
    ) {
      throw new Error(`Schema transaction recovery blocked by malformed journal ${name}`);
    }
    if (status === "quarantined") {
      throw new Error(`Schema transaction recovery blocked by unresolved quarantined journal ${name}`);
    }
    const journal = candidate as unknown as TransactionJournal;
    if (terminal) {
      const artifactsAbsent = journal.staged.every((artifact) => {
        if (
          typeof artifact !== "string" ||
          path.isAbsolute(artifact) ||
          artifact.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        ) return false;
        try {
          fs.lstatSync(path.join(this.cwd, ...artifact.split("/")));
          return false;
        } catch (error) {
          return error instanceof Error && "code" in error && error.code === "ENOENT";
        }
      });
      if (artifactsAbsent) return undefined;
    }
    const shaPattern = /^sha256:[a-f0-9]{64}$/u;
    const images = new Map<string, BeforeImage>();
    for (const raw of journal.before) {
      if (
        typeof raw !== "object" || raw === null ||
        typeof raw.path !== "string" || typeof raw.absolute !== "string" ||
        typeof raw.existed !== "boolean" || images.has(raw.path)
      ) throw new Error(`Schema transaction recovery blocked by malformed before image in ${name}`);
      const resolved = resolveWorkspaceFile(this.cwd, raw.path, { allowAbsent: true });
      if (resolved.absolute !== raw.absolute) {
        throw new Error(`Schema transaction recovery blocked by foreign before image in ${name}`);
      }
      if (raw.existed) {
        if (
          typeof raw.content !== "string" ||
          Buffer.from(raw.content, "base64").toString("base64") !== raw.content ||
          !Number.isInteger(raw.mode) || Number(raw.mode) < 0 || Number(raw.mode) > 0o777
        ) {
          throw new Error(`Schema transaction recovery blocked by malformed before image in ${name}`);
        }
      } else if (raw.content !== undefined || raw.mode !== undefined) {
        throw new Error(`Schema transaction recovery blocked by malformed absent image in ${name}`);
      }
      images.set(raw.path, raw);
    }
    const expectedArtifacts = new Set<string>();
    const operationPaths = new Set<string>();
    for (let index = 0; index < journal.operations.length; index++) {
      const operation = journal.operations[index]!;
      if (
        typeof operation !== "object" || operation === null ||
        typeof operation.path !== "string" || operationPaths.has(operation.path) ||
        !["write", "edit", "delete"].includes(operation.kind) ||
        !(operation.sourceSha256 === null || shaPattern.test(operation.sourceSha256))
      ) throw new Error(`Schema transaction recovery blocked by malformed operation in ${name}`);
      operationPaths.add(operation.path);
      const image = images.get(operation.path);
      if (!image || image.existed !== (operation.sourceSha256 !== null)) {
        throw new Error(`Schema transaction recovery blocked by mismatched before image in ${name}`);
      }
      if (image.existed) {
        const bytes = Buffer.from(image.content ?? "", "base64");
        const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (digest !== operation.sourceSha256) {
          throw new Error(`Schema transaction recovery blocked by corrupt before image in ${name}`);
        }
      }
      const resolved = resolveWorkspaceFile(this.cwd, operation.path, { allowAbsent: true });
      const expectedBackup = image.existed ? this.#backupPath(resolved, journal.id, index).relative : undefined;
      const expectedRestore = image.existed ? this.#restorePath(resolved, journal.id, index).relative : undefined;
      const hasResult = operation.kind !== "delete";
      const expectedTemporary = hasResult ? this.#stagingPath(resolved, journal.id, index).relative : undefined;
      const expectedClaim = hasResult ? this.#rollbackClaimPath(resolved, journal.id, index).relative : undefined;
      if (
        operation.backup !== expectedBackup ||
        operation.restoreTemporary !== expectedRestore ||
        operation.restoreSha256 !== (image.existed ? operation.sourceSha256 : undefined) ||
        operation.temporary !== expectedTemporary ||
        operation.rollbackClaim !== expectedClaim ||
        (hasResult ? !operation.resultSha256 || !shaPattern.test(operation.resultSha256) : operation.resultSha256 !== undefined)
      ) throw new Error(`Schema transaction recovery blocked by malformed artifact ownership in ${name}`);
      for (const artifact of [expectedBackup, expectedRestore, expectedTemporary, expectedClaim]) {
        if (artifact) expectedArtifacts.add(artifact);
      }
    }
    if (images.size !== operationPaths.size) {
      throw new Error(`Schema transaction recovery blocked by unmatched before image in ${name}`);
    }
    const staged = new Set(journal.staged);
    if (
      staged.size !== journal.staged.length ||
      staged.size !== expectedArtifacts.size ||
      [...staged].some((artifact) => typeof artifact !== "string" || !expectedArtifacts.has(artifact))
    ) throw new Error(`Schema transaction recovery blocked by malformed artifact list in ${name}`);
    return journal;
  }

  #recoverJournalsLocked(): void {
    for (const name of fs.readdirSync(this.#journalRoot).sort()) {
      if (name.startsWith(".") || !name.endsWith(".json")) continue;
      const filePath = path.join(this.#journalRoot, name);
      const journal = this.#readRecoveryJournal(filePath, name);
      if (!journal) continue;
      if (journal.status === "committed" || journal.status === "rolled_back") {
        const cleanupError = this.#cleanupStaged(journal);
        if (!cleanupError) continue;
        journal.status = "quarantined";
        journal.error = `terminal staging cleanup failed: ${cleanupError}`;
        atomicJsonWrite(filePath, journal);
        throw new Error(`Schema transaction recovery blocked by unrestorable journal ${name}: ${cleanupError}`);
      }
      const workspace = this.#workspaceEntry()?.value as SchemaWorkspaceRecord | undefined;
      if (
        workspace?.lastOutcome === "committed" &&
        workspace.lastTransactionId === journal.id
      ) {
        const cleanupError = this.#cleanupStaged(journal);
        journal.status = cleanupError ? "quarantined" : "committed";
        if (cleanupError) journal.error = `committed workspace staging cleanup failed: ${cleanupError}`;
        else delete journal.error;
        atomicJsonWrite(filePath, journal);
        if (cleanupError) {
          throw new Error(`Schema transaction recovery blocked by unrestorable journal ${name}: ${cleanupError}`);
        }
        continue;
      }
      const restoreError = journal.status === "applying"
        ? this.#rollbackPublished(journal)
        : undefined;
      const cleanupError = this.#cleanupStaged(journal);
      const rollbackError = [restoreError, cleanupError].filter(Boolean).join("; ") || undefined;
      journal.status = rollbackError ? "quarantined" : "rolled_back";
      journal.error = rollbackError ? `crash recovery failed: ${rollbackError}` : "recovered incomplete transaction";
      atomicJsonWrite(filePath, journal);
      if (rollbackError) {
        throw new Error(`Schema transaction recovery blocked by unrestorable journal ${name}: ${rollbackError}`);
      }
    }
  }
}
