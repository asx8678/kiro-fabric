import { randomBytes } from "node:crypto";
import { semanticDigest } from "../core/semantic-digest.js";
import { fabricCommitAcknowledgement, type FabricCommitAcknowledgement, type FabricRisk } from "../protocol.js";

export const CAPTURE_OPERATION_LIMIT = 256;
const CAPTURE_BYTE_LIMIT = 128 * 1024;
export const OBSERVED_REFS = [
  "local.read", "local.readMany", "local.readEvidence", "local.grep", "local.find", "local.list", "local.write", "local.edit", "local.shell",
  "probe.create", "probe.write", "probe.run", "probe.discover", "state.get", "state.set", "state.list", "state.delete",
] as const;
export interface ContinuityOperationReceipt {
  executionId: string;
  operationSequence: number;
  ref: string;
  outcome: "succeeded" | "failed";
  dispatchState: "not_dispatched" | "dispatched";
  effectOutcome: "none" | "uncertain" | "committed";
  identityHash?: string;
  path?: string;
  sha256?: string;
  sources?: { path: string; sha256: string }[];
  sourceCoverage?: "complete" | "partial";
  /** Contiguous settled admission prefix at command dispatch, not merely admission order. */
  settledBeforeDispatch?: number;
  command?: { ok: boolean; exitCode: number | null; signal: string | null };
  commitAcknowledgement?: FabricCommitAcknowledgement;
  diagnostic?: { text: string; truncated: boolean };
}
export interface ContinuityCapture {
  executionId: string;
  throughOperation: number;
  admittedOperations: number;
  capturedOperations: number;
  unsupportedOperations: number;
  excludedOperations: number;
  receipts: ContinuityOperationReceipt[];
}
export interface ContinuityOperationObserver {
  resolve(ref: string, risk: FabricRisk): void;
  prepare(args: Record<string, unknown>): void;
  dispatch(): void;
  result(value: unknown): void;
  acknowledge(error: unknown): void;
  settle(succeeded: boolean, error?: unknown): void;
  invalidate(): void;
}
interface Entry {
  sequence: number;
  category: "supported" | "unsupported" | "excluded";
  ref?: string;
  risk: FabricRisk;
  settled: boolean;
  dispatched: boolean;
  succeeded: boolean;
  details: Partial<Pick<ContinuityOperationReceipt, "identityHash" | "path" | "sha256" | "command" | "commitAcknowledgement" | "diagnostic" | "sources" | "sourceCoverage" | "settledBeforeDispatch">>;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const validObservedPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 &&
  Buffer.byteLength(value) <= 1024 && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") &&
  !/^[A-Za-z]:/.test(value) && !value.split("/").includes("..");
const categoryFor = (ref: unknown): Entry["category"] => typeof ref === "string" && (ref.startsWith("continuity.") || ref.startsWith("fabric."))
  ? "excluded" : OBSERVED_REFS.includes(ref as typeof OBSERVED_REFS[number]) ? "supported" : "unsupported";

/** Observation is never part of tool success. A broken recorder poisons capture,
 * not the provider result, dispatch, approval or cleanup semantics. */
export function observeContinuity(observer: ContinuityOperationObserver | undefined, observe: (observer: ContinuityOperationObserver) => void): void {
  if (!observer) return;
  try { observe(observer); } catch { try { observer.invalidate(); } catch { /* host observer is already unusable */ } }
}

/** Execution-local, bounded, and never durable on its own. Created only for an
 * enabled, available continuity provider. The ID does not depend on tracing. */
export class ContinuityExecution {
  readonly executionId = `ce_${randomBytes(16).toString("hex")}`;
  readonly #entries: Entry[] = [];
  #admitted = 0;
  #failed = false;
  #bytes = 0;
  constructor(readonly maxOperations = CAPTURE_OPERATION_LIMIT, readonly maxBytes = CAPTURE_BYTE_LIMIT, readonly captureFailureOutput = false) {}

  admit(requestedRef: unknown): { observer: ContinuityOperationObserver; capture: () => ContinuityCapture } {
    const sequence = ++this.#admitted;
    const category = categoryFor(requestedRef);
    const entry: Entry = { sequence, category, ...(category === "supported" ? { ref: requestedRef as string } : {}),
      risk: "execute", settled: false, dispatched: false, succeeded: false, details: {} };
    if (sequence > this.maxOperations) this.#failed = true;
    else this.#entries.push(entry);
    const guard = (operation: () => void): void => {
      if (this.#failed) return;
      try { operation(); } catch { this.#failed = true; }
    };
    const acknowledge = (error: unknown): void => {
      const ack = fabricCommitAcknowledgement(error);
      if (entry.dispatched && ack) entry.details.commitAcknowledgement = { version: 1, operation: ack.operation };
    };
    const observer: ContinuityOperationObserver = {
      invalidate: () => { this.#failed = true; },
      resolve: (ref, risk) => guard(() => {
        entry.category = categoryFor(ref); entry.risk = risk;
        if (entry.category === "supported") entry.ref = ref;
        else delete entry.ref;
      }),
      prepare: args => guard(() => {
        if (entry.category === "supported") entry.details.identityHash = semanticDigest("continuity-operation-v1", { ref: entry.ref, args });
      }),
      dispatch: () => guard(() => {
        entry.dispatched = true;
        if (["local.shell", "probe.run"].includes(entry.ref ?? "")) {
          const prior = this.#entries.slice(0, sequence - 1);
          if (prior.some(item => ["local.read", "local.readMany", "local.readEvidence", "local.write", "local.edit"].includes(item.ref ?? ""))) {
            let through = 0;
            for (const item of prior) { if (!item.settled) break; through++; }
            entry.details.settledBeforeDispatch = through;
          }
        }
      }),
      result: value => guard(() => {
        if (!entry.dispatched || entry.category !== "supported") return;
        if (entry.ref === "local.readMany" || entry.ref === "local.readEvidence") {
          const metadata: unknown = entry.ref === "local.readEvidence" && typeof value === "string" && value.startsWith("KIRO_LOCAL_EVIDENCE/1\n")
            ? JSON.parse(value.slice(value.lastIndexOf("\nMETA ") + 6)) : value;
          if (!record(metadata) || !Array.isArray(metadata.files) || metadata.files.length > 32 || typeof metadata.complete !== "boolean") throw new Error("invalid batch observation");
          const sources = new Map<string, { path: string; sha256: string }>();
          for (const file of metadata.files) {
            if (!record(file) || !validObservedPath(file.path) || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("invalid batch source");
            const prior = sources.get(file.path);
            if (prior && prior.sha256 !== file.sha256) throw new Error("conflicting batch source hashes");
            sources.set(file.path, { path: file.path, sha256: file.sha256 });
          }
          entry.details.sources = [...sources.values()];
          entry.details.sourceCoverage = metadata.complete && !(Array.isArray(metadata.failures) && metadata.failures.length) ? "complete" : "partial";
        }
        if (!record(value)) return;
        // Project exact known provider-owned fields. Never spread result bodies.
        if (["local.read", "local.write", "local.edit", "probe.write"].includes(entry.ref!)) {
          if (validObservedPath(value.path)) entry.details.path = value.path;
          if (typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256)) entry.details.sha256 = value.sha256;
        }
        if (entry.ref === "local.shell" || entry.ref === "probe.run") {
          if (typeof value.ok !== "boolean" || !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) ||
              !(value.signal === null || (typeof value.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(value.signal))) ||
              value.ok !== (value.exitCode === 0 && value.signal === null)) throw new Error("invalid command observation");
          entry.details.command = { ok: value.ok, exitCode: value.exitCode as number | null, signal: value.signal as string | null };
          if (this.captureFailureOutput && !value.ok) {
            // Explicit opt-in only. Retain a bounded excerpt, never a result body or replay instruction.
            const output = [value.stderr, value.stdout].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
            let text = "", bytes = 0;
            for (const char of output) { const size = Buffer.byteLength(char); if (bytes + size > 512) break; text += char; bytes += size; }
            if (text) entry.details.diagnostic = { text, truncated: text.length < output.length || value.truncated === true };
          }
        }
        if ((entry.ref === "local.write" || entry.ref === "local.edit") && value.changed === true) {
          entry.details.commitAcknowledgement = { version: 1, operation: entry.ref === "local.write" ? "write" : "edit" };
        } else if (entry.ref === "state.set" && Number.isSafeInteger(value.revision)) {
          entry.details.commitAcknowledgement = { version: 1, operation: "set" };
        } else if (entry.ref === "state.delete" && value.deleted === true) {
          entry.details.commitAcknowledgement = { version: 1, operation: "delete" };
        }
      }),
      acknowledge: error => guard(() => acknowledge(error)),
      settle: (succeeded, error) => guard(() => {
        if (entry.settled) throw new Error("operation settled twice");
        acknowledge(error); entry.succeeded = succeeded; entry.settled = true;
        this.#bytes += Buffer.byteLength(JSON.stringify(entry));
        if (this.#bytes > this.maxBytes) this.#failed = true;
      }),
    };
    return { observer, capture: () => this.#capture(sequence - 1) };
  }

  #capture(throughOperation: number): ContinuityCapture {
    if (this.#failed) throw new Error("continuity capture is incomplete: recorder failed or exceeded bounds; prior checkpoint retained");
    const entries = this.#entries.slice(0, throughOperation);
    if (entries.length !== throughOperation || entries.some(entry => !entry.settled)) {
      throw new Error("continuity capture requires a settled operation prefix; await earlier calls and their cleanup");
    }
    const receipts = entries.filter(entry => entry.category === "supported").map((entry): ContinuityOperationReceipt => ({
      executionId: this.executionId, operationSequence: entry.sequence, ref: entry.ref!,
      outcome: entry.succeeded ? "succeeded" : "failed", dispatchState: entry.dispatched ? "dispatched" : "not_dispatched",
      effectOutcome: !entry.dispatched ? "none" : entry.details.commitAcknowledgement ? "committed" : entry.risk === "read" && entry.succeeded ? "none" : "uncertain",
      ...structuredClone(entry.details),
    }));
    return { executionId: this.executionId, throughOperation, admittedOperations: throughOperation, capturedOperations: receipts.length,
      unsupportedOperations: entries.filter(entry => entry.category === "unsupported").length,
      excludedOperations: entries.filter(entry => entry.category === "excluded").length, receipts };
  }
}
