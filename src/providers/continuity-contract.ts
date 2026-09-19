import type { FabricActionDescriptor } from "../protocol.js";
import { CHECK_STATUSES, FACT_KINDS, MAX_TEXT_BYTES } from "../continuity/records.js";

const text = (maximum: number) => ({ type: "string", minLength: 1, maxLength: maximum });
const integer = (minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => ({ type: "integer", minimum, maximum });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const fact = () => object({ kind: { type: "string", enum: [...FACT_KINDS] }, text: text(MAX_TEXT_BYTES) });
const check = () => object({ id: text(128), text: text(MAX_TEXT_BYTES), status: { type: "string", enum: [...CHECK_STATUSES] },
  // Keep the descriptor within the registry's bounded schema subset. The store
  // additionally enforces the exact sentinel and uniqueness before any mutation.
  evidence: { type: ["string", "array"], minLength: 8, maxLength: 8, maxItems: 32, items: integer(1, 512) }, note: text(MAX_TEXT_BYTES),
  review: object({ taskId: text(128), revision: integer(), findingId: text(128), status: { type: "string", enum: ["candidate", "confirmed", "conditional", "disproved"] }, scope: text(MAX_TEXT_BYTES) }),
}, ["id", "text", "status"]);
const schemas: Record<string, Record<string, unknown>> = {
  create: object({ objective: text(MAX_TEXT_BYTES), constraints: { type: "array", maxItems: 31, items: text(MAX_TEXT_BYTES) } }, ["objective"]),
  checkpoint: object({ taskId: text(35), expectedRevision: integer(), requestId: text(128), facts: { type: "array", maxItems: 64, items: fact() }, checks: { type: "array", maxItems: 16, items: check() }, captureCurrentExecution: { type: "boolean" } }, ["taskId", "expectedRevision", "requestId"]),
  read: object({ taskId: text(35), expectedRevision: integer(), maxSummaryBytes: integer(1, 16384), view: { type: "string", enum: ["history", "task"] } }, ["taskId"]),
  recall: object({ taskId: text(35), expectedRevision: integer(), hash: text(64), query: text(512), checkId: text(128), path: text(1024), ref: text(128), outcome: { type: "string", enum: ["succeeded", "failed"] }, offset: integer(0, 512), limit: integer(1, 20), snippetChars: integer(40, 512) }, ["taskId"]),
  list: object({ offset: integer(0, 32), limit: integer(1, 32), expectedIndexRevision: integer(0) }, []),
  expand: object({ taskId: text(35), expectedRevision: integer(), hash: text(64), fromSequence: integer(1, 513), limit: integer(1, 64) }, ["taskId", "expectedRevision", "hash"]),
  delete: object({ taskId: text(35), expectedRevision: integer() }),
};
export const CONTINUITY_ACTION_DESCRIPTORS: readonly FabricActionDescriptor[] = [
  ["create", "Create an explicit durable task of caller-declared facts; not native compaction", "write"],
  ["checkpoint", "Append declarations/checks and optionally capture settled host receipts; bounded evidence links, revision CAS and idempotent publication", "write"],
  ["read", "Bounded history or task view; task view rechecks linked workspace hashes, not semantic correctness or whole-repository freshness", "read"],
  ["recall", "Search retained records of an explicit task; literal AND terms, structural filters, bounded snippets and revision/hash-bound expansion", "read"],
  ["list", "Page task metadata in this workspace; continuations require expectedIndexRevision. Explicitly select a task, never infer the latest chat", "read"],
  ["expand", "Expand exact admitted records using a revision/hash-bound source pointer", "read"],
  ["delete", "Delete a selected durable task with mandatory revision checking", "write"],
].map(([name, description, risk]) => ({ name: name!, description: description!, risk: risk as "read" | "write", effect: { kind: risk as "read" | "write" }, inputSchema: schemas[name!]! }));

export const CONTINUITY_GUEST_DECLARATIONS = `
type ContinuityFact = {kind:"objective"|"constraint"|"decision"|"open-check"|"next-step";text:string};
type ContinuityCheck = {id:string;text:string;status:"open"|"passed"|"failed"|"blocked";evidence?:number[]|"captured";note?:string;review?:{taskId:string;revision:number;findingId:string;status:"candidate"|"confirmed"|"conditional"|"disproved";scope:string}};
type ContinuityCheckRecord = Omit<ContinuityCheck,"evidence"> & {sequence:number;provenance:"declared";kind:"check";evidence:number[]};
type ContinuityCaptureMetadata = {executionId:string;throughOperation:number;admittedOperations:number;capturedOperations:number;unsupportedOperations:number;excludedOperations:number};
type ContinuityDeclarationRecord = ContinuityFact & {sequence:number;provenance:"declared"};
type ContinuityOperationRecord = {sequence:number;provenance:"host-observed";kind:"operation";executionId:string;operationSequence:number;ref:string;outcome:"succeeded"|"failed";dispatchState:"not_dispatched"|"dispatched";effectOutcome:"none"|"uncertain"|"committed";identityHash?:string;path?:string;sha256?:string;sources?:{path:string;sha256:string}[];sourceCoverage?:"complete"|"partial";settledBeforeDispatch?:number;command?:{ok:boolean;exitCode:number|null;signal:string|null};diagnostic?:{text:string;truncated:boolean};commitAcknowledgement?:{version:1;operation:"set"|"delete"|"write"|"edit"}};
type ContinuityCaptureRecord = ContinuityCaptureMetadata & {sequence:number;provenance:"host-observed";kind:"capture"};
type ContinuityRecord = ContinuityDeclarationRecord | ContinuityOperationRecord | ContinuityCaptureRecord | ContinuityCheckRecord;
type ContinuityHandle = {taskId:string;revision:number;hash:string;admittedRecords:number};
type ContinuityCheckpointResult = ContinuityHandle & {alreadyPublished:boolean;publishedThroughSequence:number;capture?:ContinuityCaptureMetadata};
type ContinuityReadResult = {schemaVersion:1|2|3;projectorVersion:1|2|3;taskId:string;revision:number;hash:string;summary:string;coverage:{admittedRecords:number;shownRecords:number;omittedRecords:number;conversation:"not-captured";operations:"not-captured"|"selected-prefixes";capturedPrefixes?:number;observedOperations?:number;latestCapture?:ContinuityCaptureMetadata};omittedRange:{fromSequence:number;throughSequence:number}|null};
type ContinuityCheckAssessment = {id:string;sequence:number;declaredStatus:"open"|"passed"|"failed"|"blocked";commandOutcome:"passed"|"failed"|"unobserved";freshness:"unchanged"|"stale"|"unavailable"|"unbound";inputBinding:"observed-before-command"|"unbound";needsAttention:boolean};
type ContinuityTaskView = {view:"task";projectorVersion:3;taskId:string;revision:number;hash:string;summary:string;checks:ContinuityCheckAssessment[];coverage:{admittedRecords:number;shownRecords:number;omittedRecords:number;activeChecks:number;attentionChecks:number;conversation:"not-captured";operations:"not-captured"|"selected-prefixes";semanticValidation:false;sourceScope:"linked-files-only"};omittedRanges:{fromSequence:number;throughSequence:number}[]};
type ContinuityRecallArguments = {taskId:string;expectedRevision?:number;hash?:string;query?:string;checkId?:string;path?:string;ref?:string;outcome?:"succeeded"|"failed";offset?:number;limit?:number;snippetChars?:number};
type ContinuityRecallResult = {taskId:string;revision:number;hash:string;total:number;hits:{sequence:number;kind:string;provenance:string;snippet:string;truncated:boolean;follow:{ref:"continuity.expand";args:{taskId:string;expectedRevision:number;hash:string;fromSequence:number;limit:1}}}[];next:{ref:"continuity.recall";args:ContinuityRecallArguments}|null;coverage:{scope:"retained-task-records";scannedRecords:number;conversation:"not-captured";operations:"not-captured"|"selected-prefixes";freshness:"historical-not-reconciled"}};
type ContinuityExpandResult = {taskId:string;revision:number;hash:string;records:ContinuityRecord[];total:number;nextSequence:number|null};
type ContinuityListResult = {indexRevision:number;tasks:{taskId:string;revision:number;updatedAt:number}[];total:number;nextOffset:number|null};
/** Opt-in recovery. No native compaction, inference or implicit task selection. */
declare const continuity: Readonly<{
  create(args:{objective:string;constraints?:string[]}):Promise<ContinuityHandle>;
  /** Milestones only. Await calls before capture. evidence:"captured" links <=32 receipts in this execution prefix. Retrying a publication never replays or recaptures work. */
  checkpoint(args:{taskId:string;expectedRevision:number;requestId:string;facts?:ContinuityFact[];checks?:ContinuityCheck[];captureCurrentExecution?:boolean}):Promise<ContinuityCheckpointResult>;
  read(args:{taskId:string;expectedRevision?:number;maxSummaryBytes?:number;view:"task"}):Promise<ContinuityTaskView>;
  read(args:{taskId:string;expectedRevision?:number;maxSummaryBytes?:number;view?:"history"}):Promise<ContinuityReadResult>;
  /** Defaults: 5 hits, 200 characters each. Follow next verbatim; expand before relying on snippets. No match means no match in retained records, not absence of behavior. */
  recall(args:ContinuityRecallArguments):Promise<ContinuityRecallResult>;
  /** Nonzero offsets require the indexRevision from the first page as expectedIndexRevision; restart listing on conflict. */
  list(args?:{offset?:number;limit?:number;expectedIndexRevision?:number}):Promise<ContinuityListResult>;
  expand(args:{taskId:string;expectedRevision:number;hash:string;fromSequence?:number;limit?:number}):Promise<ContinuityExpandResult>;
  delete(args:{taskId:string;expectedRevision:number}):Promise<{taskId:string;deleted:true}>;
}>;
`;
