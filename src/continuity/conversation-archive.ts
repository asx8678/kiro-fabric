import { createHash } from "node:crypto";
import { StateProvider } from "../providers/state-provider.js";
import { continuityBoundedId, continuityBoundedKey } from "./validation.js";
import type { FabricInvocationContext } from "../protocol.js";

const ARCHIVE_MAX_ARCHIVES = 16;
const ARCHIVE_MAX_EVENTS = 256;
const ARCHIVE_MAX_EVENT_BYTES = 8192;
const ARCHIVE_MAX_DOCUMENT_BYTES = 512 * 1024;
const ARCHIVE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const ARCHIVE_JSON_DEPTH = 64;
const ARCHIVE_BATCH_LIMIT = 64;

export type ContinuityArchiveEventKind = "user" | "assistant" | "tool-call" | "tool-result" | "fabric-operation" | "checkpoint-marker";
const EVENT_KINDS: readonly ContinuityArchiveEventKind[] = ["user", "assistant", "tool-call", "tool-result", "fabric-operation", "checkpoint-marker"];

export interface ContinuityArchiveEventInput { eventId: string; kind: ContinuityArchiveEventKind; payload: unknown }
export interface ContinuityArchiveEvent {
  eventId: string; sequence: number; kind: ContinuityArchiveEventKind;
  payload: unknown; payloadHash: string; previousHash: string; eventHash: string;
}
export interface ContinuityArchiveHead { archiveId: string; revision: number; events: number; headHash: string }
export interface ContinuityArchiveAppendResult { archiveId: string; revision: number; appendedSequences: number[]; alreadyAppended: string[]; headHash: string }
export interface ContinuityArchivePage { archiveId: string; revision: number; events: ContinuityArchiveEvent[]; total: number; nextOffset: number | null }
export interface ContinuityArchiveOptions { maxArchives?: number; maxEvents?: number; maxEventBytes?: number; maxDocumentBytes?: number; maxTotalBytes?: number }
interface ContinuityArchiveDocument { schemaVersion: 1; archiveId: string; workspaceKey: string; events: ContinuityArchiveEvent[]; headHash: string }

const boundedId = (value: unknown, label: string): string => continuityBoundedId(value, `archive ${label}`);
const workspaceKeyOf = (value: unknown): string => continuityBoundedKey(value, "archive workspace key");
const eventKindOf = (value: unknown): ContinuityArchiveEventKind => {
  if (typeof value !== "string" || !EVENT_KINDS.includes(value as ContinuityArchiveEventKind)) throw new Error("continuity archive event kind is malformed");
  return value as ContinuityArchiveEventKind;
};
const payloadHashOfText = (text: string): string =>
  createHash("sha256").update("continuity-archive-event-v1\0").update(text).digest("hex");
const eventHashOf = (event: Pick<ContinuityArchiveEvent, "eventId" | "sequence" | "kind" | "payloadHash" | "previousHash">): string =>
  createHash("sha256").update("continuity-archive-chain-v1\0")
    .update(JSON.stringify([event.eventId, event.sequence, event.kind, event.payloadHash, event.previousHash])).digest("hex");

interface AdmittedPayload { value: unknown; text: string }

/** Admits one payload as bounded plain JSON and returns the deep-copied
 * normalized value together with its exact serialized text. Only JSON
 * primitives, dense arrays and plain objects (Object.prototype or a null
 * prototype) with enumerable own data properties are accepted. Buffers and
 * typed arrays, dates, maps, sets, custom prototypes, accessors, custom
 * `toJSON`, functions, symbols, undefined, bigints, non-finite numbers and
 * cycles are rejected before anything is published, and getters are never
 * invoked. Traversal is bounded by a node budget before serialization, so an
 * oversized payload cannot be built into a huge string first. Objects are
 * rebuilt with a null prototype while preserving property order (including
 * numeric-string keys), so an admitted value stringifies identically on
 * write and after read-back and a `__proto__` key stays an own data property
 * instead of polluting a prototype. */
const admitPayload = (value: unknown, maxEventBytes: number): AdmittedPayload => {
  let nodes = 0;
  // The budget stays above the depth limit so a depth violation is always
  // reported as such; wide structures exhaust the traversal budget instead.
  const nodeBudget = Math.max(ARCHIVE_JSON_DEPTH + 2, Math.ceil(maxEventBytes / 2));
  const admit = (input: unknown, depth: number, ancestors: WeakSet<object>): unknown => {
    if (depth > ARCHIVE_JSON_DEPTH) throw new Error("continuity archive payload exceeds JSON depth bounds");
    if (++nodes > nodeBudget) throw new Error("continuity archive payload exceeds node bounds");
    switch (typeof input) {
      case "boolean":
      case "string":
        return input;
      case "number":
        if (!Number.isFinite(input)) throw new Error("continuity archive payload is not bounded JSON");
        return input;
      case "object": {
        if (input === null) return null;
        if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
          throw new Error("continuity archive payload is not bounded JSON");
        }
        if (Object.getOwnPropertySymbols(input).length > 0) throw new Error("continuity archive payload is not bounded JSON");
        if (typeof (input as { toJSON?: unknown }).toJSON === "function") throw new Error("continuity archive payload is not bounded JSON");
        if (ancestors.has(input)) throw new Error("continuity archive payload contains a cycle");
        const prototype = Object.getPrototypeOf(input);
        if (Array.isArray(input)) {
          if (prototype !== Array.prototype) throw new Error("continuity archive payload is not bounded JSON");
          ancestors.add(input);
          const copy: unknown[] = [];
          for (let index = 0; index < input.length; index++) {
            if (input[index] === undefined) throw new Error("continuity archive payload is not bounded JSON");
            copy.push(admit(input[index], depth + 1, ancestors));
          }
          ancestors.delete(input);
          return copy;
        }
        if (prototype !== Object.prototype && prototype !== null) throw new Error("continuity archive payload is not bounded JSON");
        ancestors.add(input);
        const copy: Record<string, unknown> = Object.create(null);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
          if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable || descriptor.value === undefined) {
            throw new Error("continuity archive payload is not bounded JSON");
          }
          copy[key] = admit(descriptor.value, depth + 1, ancestors);
        }
        ancestors.delete(input);
        return copy;
      }
      default:
        // undefined, function, symbol, bigint.
        throw new Error("continuity archive payload is not bounded JSON");
    }
  };
  const normalized = admit(value, 0, new WeakSet());
  const text = JSON.stringify(normalized);
  if (text === undefined || Buffer.byteLength(text, "utf8") > maxEventBytes) {
    throw new Error("continuity archive event payload exceeds bounds; earlier events retained");
  }
  return { value: normalized, text };
};

const parseDocument = (value: unknown, expectedArchiveId: string, expectedWorkspaceKey: string, maxEvents: number, maxEventBytes: number): ContinuityArchiveDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("continuity archive document is missing or corrupt");
  const document = value as Partial<ContinuityArchiveDocument>;
  if (document.schemaVersion !== 1 || document.archiveId !== expectedArchiveId || document.workspaceKey !== expectedWorkspaceKey ||
      !Array.isArray(document.events) || typeof document.headHash !== "string") throw new Error("continuity archive document is malformed or bound to another conversation/workspace");
  const events = document.events;
  if (events.length > maxEvents) throw new Error("continuity archive event quota was exceeded");
  const seen = new Set<string>();
  let previousHash = "";
  events.forEach((event, index) => {
    if (!event || typeof event !== "object") throw new Error("continuity archive event chain is corrupt");
    eventKindOf(event.kind);
    boundedId(event.eventId, "event id");
    if (event.sequence !== index + 1 || event.previousHash !== previousHash || seen.has(event.eventId)) throw new Error("continuity archive event chain is corrupt");
    // One serialization per event feeds both the hash verification and the
    // persisted byte bound; reads stay linear in the document, never double.
    const text = JSON.stringify(event.payload);
    if (event.eventHash !== eventHashOf({ eventId: event.eventId, sequence: event.sequence, kind: event.kind, payloadHash: event.payloadHash, previousHash: event.previousHash }) ||
        typeof text !== "string" || event.payloadHash !== payloadHashOfText(text)) throw new Error("continuity archive event hash chain does not match its contents");
    if (Buffer.byteLength(text, "utf8") > maxEventBytes) throw new Error("continuity archive event payload exceeds persisted bounds");
    seen.add(event.eventId);
    previousHash = event.eventHash;
  });
  if (document.headHash !== previousHash) throw new Error("continuity archive head hash does not match the event chain");
  return { schemaVersion: 1, archiveId: expectedArchiveId, workspaceKey: expectedWorkspaceKey, events, headHash: document.headHash };
};

/** Private, bounded, logically append-only archive of original conversation
 * events. Atomic publication rewrites a snapshot document under a compare-and-
 * set revision; this is a CAS-protected logical append-only contract, not
 * physical WORM storage. Not a guest provider: callers are trusted host
 * components with explicit storage authority, and no event is ever deleted or
 * evicted to make room. */
export class ContinuityConversationArchive {
  readonly #state: StateProvider;
  readonly #maxEvents: number;
  readonly #maxEventBytes: number;
  readonly #maxDocumentBytes: number;
  constructor(root: string, options: ContinuityArchiveOptions = {}) {
    this.#maxEvents = options.maxEvents ?? ARCHIVE_MAX_EVENTS;
    this.#maxEventBytes = options.maxEventBytes ?? ARCHIVE_MAX_EVENT_BYTES;
    this.#maxDocumentBytes = options.maxDocumentBytes ?? ARCHIVE_MAX_DOCUMENT_BYTES;
    this.#state = new StateProvider(root, {
      maxEntries: options.maxArchives ?? ARCHIVE_MAX_ARCHIVES,
      maxValueChars: Math.ceil((options.maxDocumentBytes ?? ARCHIVE_MAX_DOCUMENT_BYTES) / 2),
      maxValueBytes: options.maxDocumentBytes ?? ARCHIVE_MAX_DOCUMENT_BYTES,
      maxTotalChars: Math.ceil((options.maxTotalBytes ?? ARCHIVE_MAX_TOTAL_BYTES) / 2),
      maxTotalBytes: options.maxTotalBytes ?? ARCHIVE_MAX_TOTAL_BYTES,
    });
  }

  async #load(archiveIdInput: unknown, workspaceKeyInput: unknown, context: FabricInvocationContext): Promise<{ revision: number; document: ContinuityArchiveDocument }> {
    const id = boundedId(archiveIdInput, "archive id"), key = workspaceKeyOf(workspaceKeyInput);
    const entry = await this.#state.invoke("get", { key: `ca:${id}` }, context) as { found?: false; revision: number; value: unknown };
    if (entry.found === false) return { revision: 0, document: { schemaVersion: 1, archiveId: id, workspaceKey: key, events: [], headHash: "" } };
    return { revision: entry.revision, document: parseDocument(entry.value, id, key, this.#maxEvents, this.#maxEventBytes) };
  }

  async head(archiveIdInput: unknown, workspaceKeyInput: unknown, context: FabricInvocationContext): Promise<ContinuityArchiveHead> {
    const { revision, document } = await this.#load(archiveIdInput, workspaceKeyInput, context);
    return { archiveId: document.archiveId, revision, events: document.events.length, headHash: document.headHash };
  }

  /** Appends original events after the observed revision. Re-submitting the
   * same event ids with identical content is idempotent and never rewrites;
   * changed content for a known id conflicts. New events require the exact
   * observed revision, so concurrent writers produce one winner and one
   * explicit conflict. Quota or validation failure preserves earlier events. */
  async append(archiveIdInput: unknown, workspaceKeyInput: unknown, entries: unknown, expectedRevisionInput: unknown, context: FabricInvocationContext): Promise<ContinuityArchiveAppendResult> {
    const id = boundedId(archiveIdInput, "archive id"), key = workspaceKeyOf(workspaceKeyInput);
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > ARCHIVE_BATCH_LIMIT) throw new Error("continuity archive append requires 1 to 64 events");
    if (!Number.isSafeInteger(expectedRevisionInput) || (expectedRevisionInput as number) < 0) throw new Error("continuity archive append requires the observed document revision");
    const { revision, document } = await this.#load(id, key, context);
    const existing = new Map(document.events.map(event => [event.eventId, event]));
    const batchIds = new Set<string>();
    const events = [...document.events];
    const alreadyAppended: string[] = [];
    const appendedSequences: number[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") throw new Error("continuity archive event is malformed");
      const record = entry as Record<string, unknown>;
      const eventId = boundedId(record.eventId, "event id");
      if (batchIds.has(eventId)) throw new Error("continuity archive append contains duplicate event ids");
      batchIds.add(eventId);
      const kind = eventKindOf(record.kind);
      // One bounded admission routine validates, deep-copies and serializes the
      // payload: the stored value, its hash and its read-back form are the same
      // plain-JSON representation, so the chain still verifies after reopen.
      const admitted = admitPayload(record.payload, this.#maxEventBytes);
      const payloadHash = payloadHashOfText(admitted.text);
      const prior = existing.get(eventId);
      if (prior) {
        // Immutable event identity: a retry must repeat both the kind and the
        // exact payload bytes; anything else conflicts, even at a stale revision.
        if (prior.kind !== kind || prior.payloadHash !== payloadHash) throw new Error(`continuity archive event id conflict: ${eventId}`);
        alreadyAppended.push(eventId);
        continue;
      }
      const event: ContinuityArchiveEvent = { eventId, sequence: events.length + 1, kind, payload: admitted.value,
        payloadHash, previousHash: events.at(-1)?.eventHash ?? "", eventHash: "" };
      event.eventHash = eventHashOf(event);
      events.push(event);
      appendedSequences.push(event.sequence);
    }
    if (!appendedSequences.length) return { archiveId: id, revision, appendedSequences: [], alreadyAppended, headHash: document.headHash };
    if (events.length > this.#maxEvents) throw new Error("continuity archive event quota reached; earlier events retained");
    const updated: ContinuityArchiveDocument = { schemaVersion: 1, archiveId: id, workspaceKey: key, events, headHash: events.at(-1)?.eventHash ?? "" };
    // One serialization of the assembled document serves both the archive's
    // own bound check and the store's value check; the guest set path would
    // serialize it again and parse it back on every append.
    const documentText = JSON.stringify(updated);
    if (Buffer.byteLength(documentText, "utf8") > this.#maxDocumentBytes) throw new Error("continuity archive document exceeds bounds; earlier events retained");
    if (revision !== expectedRevisionInput) throw new Error("continuity archive revision conflict; read before retrying");
    const result = await this.#state.setSerialized({ key: `ca:${id}`, value: updated, text: documentText, expectedRevision: revision }, context);
    return { archiveId: id, revision: result.revision, appendedSequences, alreadyAppended, headHash: updated.headHash };
  }

  async events(archiveIdInput: unknown, workspaceKeyInput: unknown, context: FabricInvocationContext, offsetInput: unknown = 0, limitInput: unknown = 64): Promise<ContinuityArchivePage> {
    const { revision, document } = await this.#load(archiveIdInput, workspaceKeyInput, context);
    const offset = offsetInput as number, limit = limitInput as number;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new Error("continuity archive page bounds are invalid");
    if (offset > document.events.length) throw new Error("continuity archive page offset is out of range");
    const slice = document.events.slice(offset, offset + limit);
    return { archiveId: document.archiveId, revision, events: structuredClone(slice), total: document.events.length,
      nextOffset: offset + slice.length < document.events.length ? offset + slice.length : null };
  }
}
