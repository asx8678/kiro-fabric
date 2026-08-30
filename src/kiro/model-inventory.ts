// Kiro model discovery: parse `kiro-cli chat --v3 --list-models --format json`, cache the
// inventory per binary, and fall back to Kiro's always-supported auto route
// when the probe fails. Non-billable: this never sends a prompt.

import { execFile } from "node:child_process";
import { assertSupportedKiro } from "./compatibility.js";

export interface KiroModelEntry {
  runner: "kiro";
  provider: "kiro";
  id: string;
  name: string;
  key: string;
  creditMultiplier?: number;
  isDefault?: boolean;
}

const PROBE_TIMEOUT_MS = 15_000;

const cache = new Map<string, { entries: KiroModelEntry[]; probedAt: number }>();
const inFlight = new Map<string, Promise<KiroModelEntry[]>>();

const AUTO_MODEL: KiroModelEntry = {
  runner: "kiro",
  provider: "kiro",
  id: "auto",
  name: "auto",
  key: "kiro/auto",
  isDefault: true,
};

export const KIRO_MODEL_LIST_ARGUMENTS = [
  "chat",
  "--v3",
  "--list-models",
  "--format",
  "json",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonModelRows = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["models", "availableModels", "items", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) {
      const nested = jsonModelRows(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
};

const parseJsonModels = (output: string): KiroModelEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return [];
  }
  const root = isRecord(parsed) ? parsed : undefined;
  const defaultId =
    (typeof root?.default_model === "string" && root.default_model) ||
    (typeof root?.defaultModel === "string" && root.defaultModel) ||
    undefined;
  return jsonModelRows(parsed).flatMap((value) => {
    const row = isRecord(value) ? value : undefined;
    const id =
      typeof value === "string"
        ? value
        : typeof row?.id === "string"
          ? row.id
          : typeof row?.modelId === "string"
            ? row.modelId
            : typeof row?.model_id === "string"
              ? row.model_id
              : undefined;
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/iu.test(id)) return [];
    const displayName =
      (typeof row?.name === "string" && row.name.trim()) ||
      (typeof row?.displayName === "string" && row.displayName.trim()) ||
      (typeof row?.model_name === "string" && row.model_name.trim()) ||
      (typeof row?.description === "string" && row.description.trim()) ||
      id;
    const rawMultiplier =
      row?.creditMultiplier ??
      row?.credit_multiplier ??
      row?.rate_multiplier ??
      row?.rateMultiplier ??
      row?.credits ??
      row?.multiplier;
    const creditMultiplier =
      typeof rawMultiplier === "number" && Number.isFinite(rawMultiplier)
        ? rawMultiplier
        : typeof rawMultiplier === "string" && /^[0-9]+(?:\.[0-9]+)?x?$/i.test(rawMultiplier)
          ? Number(rawMultiplier.replace(/x$/i, ""))
          : undefined;
    return [{
      runner: "kiro" as const,
      provider: "kiro" as const,
      id,
      name: displayName === id ? id : `${id} — ${displayName}`,
      key: `kiro/${id}`,
      ...(creditMultiplier !== undefined ? { creditMultiplier } : {}),
      isDefault:
        row?.isDefault === true ||
        row?.default === true ||
        row?.selected === true ||
        id === defaultId ||
        id === "auto",
    }];
  });
};

export const parseKiroModelList = (output: string): KiroModelEntry[] => {
  const jsonEntries = parseJsonModels(output);
  if (jsonEntries.length > 0) return jsonEntries;
  const entries: KiroModelEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    const match = /^([* ]?)\s{0,4}([a-z0-9][a-z0-9._-]*)\s+((?:[0-9]+(?:\.[0-9]+)?x)|-----)\s+credits\s*(.*)$/iu.exec(line);
    if (!match) continue;
    const [, marker, id, rawMultiplier, description] = match;
    const multiplier = rawMultiplier!;
    entries.push({
      runner: "kiro",
      provider: "kiro",
      id: id!,
      name: description?.trim() ? `${id} — ${description!.trim()}` : id!,
      key: `kiro/${id}`,
      ...(multiplier === "-----" ? {} : { creditMultiplier: Number(multiplier.slice(0, -1)) }),
      isDefault: marker === "*",
    });
  }
  return entries;
};

export const listKiroModels = (
  binary = "kiro-cli",
  refresh = false,
): Promise<KiroModelEntry[]> => {
  const cached = cache.get(binary);
  if (cached && !refresh) return Promise.resolve(cached.entries);
  const active = inFlight.get(binary);
  if (active) return active;
  const probe = assertSupportedKiro(binary)
    .then((identity) => new Promise<KiroModelEntry[]>((resolve) => {
      execFile(
        identity.executablePath,
        [...KIRO_MODEL_LIST_ARGUMENTS],
        { timeout: PROBE_TIMEOUT_MS, env: { ...process.env, NO_COLOR: "1", TERM: "dumb" } },
        (error, stdout, stderr) => {
          const parsed = error
            ? []
            : parseKiroModelList(`${stdout}\n${stderr}`.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ""));
          resolve(parsed.length > 0 ? parsed : [{ ...AUTO_MODEL }]);
        },
      );
    }))
    .catch(() => [{ ...AUTO_MODEL }])
    .then((entries) => {
      cache.set(binary, { entries, probedAt: Date.now() });
      return entries;
    });
  inFlight.set(binary, probe);
  void probe.finally(() => {
    if (inFlight.get(binary) === probe) inFlight.delete(binary);
  });
  return probe;
};

/** Test hook: reset the per-binary inventory cache. */
export const resetKiroModelInventoryCache = (): void => {
  cache.clear();
  inFlight.clear();
};
