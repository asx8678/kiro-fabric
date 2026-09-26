// Derived from pi-fovea b594483868d27b7eb37a9b185c59ce812f8a9c01 (MIT); see UPSTREAM-LICENSE.txt.
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { JOURNAL_TTL_MS, maintainTempStorage, readTempText } from "./temp-storage.js";
import { privateTmpdir as tmpdir } from "./context.js";
import { join, resolve } from "node:path";

const JOURNAL_VERSION = 1;

interface MutationRecord {
  file: string;
  beforeSha?: (string) | undefined;
  afterSha?: (string) | undefined;
  owner: string;
  toolCallId: string;
  commitOrder?: (number) | undefined;
  at: number;
}

interface MutationJournal {
  version: number;
  root: string;
  owner: string;
  records: MutationRecord[];
}

type ProvenanceKind = "current-session" | "other-session" | "mixed" | "unattributed";

export interface SyncProvenance {
  kind: ProvenanceKind;
  files: Record<string, ProvenanceKind>;
}

const sha1 = (value: string): string => createHash("sha1").update(value).digest("hex");
const ownerFor = (sessionId: string): string => sha1(sessionId).slice(0, 16);
const rootKey = (root: string): string => sha1(resolve(root)).slice(0, 16);
const prefixFor = (root: string): string => `pi-fovea-provenance-${rootKey(root)}-`;

export const provenancePathFor = (root: string, sessionId: string): string =>
  join(tmpdir(), `${prefixFor(root)}${ownerFor(sessionId)}.json`);

const readRecords = async (root: string, since: number): Promise<MutationRecord[]> => {
  void maintainTempStorage();
  const prefix = prefixFor(root);
  const cutoff = Math.max(since, Date.now() - JOURNAL_TTL_MS);
  let names: string[];
  try {
    names = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix) && /^[a-f0-9]{16}\.json$/.test(name.slice(prefix.length)));
  } catch {
    return [];
  }
  const records: MutationRecord[] = [];
  await Promise.all(names.map(async (name) => {
    const path = join(tmpdir(), name);
    try {
      const journal = JSON.parse(await readTempText(path, Infinity)) as MutationJournal;
      if (journal.version !== JOURNAL_VERSION || journal.root !== resolve(root) || !Array.isArray(journal.records)) return;
      const live = journal.records.filter((record) => record.at >= cutoff);
      records.push(...live);
    } catch {
      // A concurrent atomic replacement or malformed journal is unattributed.
    }
  }));
  // Code-unit tie-breaks keep record ordering locale-independent.
  return records.sort((a, b) => a.at - b.at
    || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0)
    || (a.commitOrder ?? Number.MAX_SAFE_INTEGER) - (b.commitOrder ?? Number.MAX_SAFE_INTEGER)
    || (a.toolCallId < b.toolCallId ? -1 : a.toolCallId > b.toolCallId ? 1 : 0));
};

const kindForOwners = (owners: Set<string>, currentOwner: string): ProvenanceKind => {
  if (!owners.size) return "unattributed";
  if (owners.size === 1) return owners.has(currentOwner) ? "current-session" : "other-session";
  return "mixed";
};

const ownersForTransition = (
  records: MutationRecord[],
  beforeSha: string | undefined,
  afterSha: string | undefined,
): Set<string> => {
  const states = new Map<string, Set<string>>();
  const key = (sha: string | undefined): string => sha ?? "\0deleted";
  states.set(key(beforeSha), new Set());
  for (const record of records) {
    const owners = states.get(key(record.beforeSha));
    if (!owners) continue;
    const nextKey = key(record.afterSha);
    const next = states.get(nextKey) ?? new Set<string>();
    for (const owner of owners) next.add(owner);
    next.add(record.owner);
    states.set(nextKey, next);
  }
  return states.get(key(afterSha)) ?? new Set();
};

export const attributeChanges = async (
  root: string,
  sessionId: string,
  since: number,
  changes: Array<{ file: string; beforeSha?: (string) | undefined; afterSha?: (string) | undefined }>,
): Promise<SyncProvenance> => {
  const records = await readRecords(root, since);
  const recordsByFile = new Map<string, MutationRecord[]>();
  for (const record of records) {
    const matching = recordsByFile.get(record.file) ?? [];
    matching.push(record);
    recordsByFile.set(record.file, matching);
  }
  const currentOwner = ownerFor(sessionId);
  const files: Record<string, ProvenanceKind> = {};
  for (const change of changes) {
    files[change.file] = kindForOwners(
      ownersForTransition(recordsByFile.get(change.file) ?? [], change.beforeSha, change.afterSha),
      currentOwner,
    );
  }
  const kinds = new Set(Object.values(files));
  return {
    kind: kinds.size === 0 ? "unattributed" : kinds.size === 1 ? [...kinds][0]! : "mixed",
    files,
  };
};
