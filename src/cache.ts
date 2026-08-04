import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FabricConfig } from "./config.js";
import type { NormalizedAiRequest } from "./runners/types.js";
import type { AiRunResult } from "../types/fabric-lite.js";

export type CacheEntry = Pick<AiRunResult, "value" | "model" | "requestedModel" | "resolvedModel" | "resolutionSource" | "inputChars" | "outputChars"> & {
  storedAt: number;
};

type CacheKey = {
  instruction: string;
  context: string;
  role: NormalizedAiRequest["role"];
  maxOutputChars: number;
  timeoutMs: number;
  model: string | null;
  schema: Record<string, unknown> | null;
  runner: { type: FabricConfig["runner"]["type"]; workerAgent: string };
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .flatMap((key) => {
          const child = stableValue((value as Record<string, unknown>)[key]);
          return child === undefined ? [] : [[key, child]];
        }),
    );
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value)) ?? "null";
}

export function cacheKey(request: NormalizedAiRequest, config: FabricConfig): string {
  const components: CacheKey = {
    instruction: request.instruction,
    context: request.context,
    role: request.role,
    maxOutputChars: request.maxOutputChars,
    timeoutMs: request.timeoutMs,
    model: request.model ?? config.runner.defaultModel,
    schema: request.schema ?? null,
    runner: { type: config.runner.type, workerAgent: config.runner.workerAgent },
  };
  return createHash("sha256").update(stableSerialize(components)).digest("hex");
}

export function cacheFilePath(root: string, key: string): string {
  return path.join(root, ".fabric-lite", "cache", `${key}.json`);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (!("value" in entry) || typeof entry.storedAt !== "number" || !Number.isFinite(entry.storedAt)) return false;
  if (typeof entry.resolutionSource !== "string" || !["kiro-metadata", "runner", "unknown"].includes(entry.resolutionSource)) return false;
  if (!Number.isFinite(entry.inputChars) || !Number.isFinite(entry.outputChars)) return false;
  for (const key of ["model", "requestedModel", "resolvedModel"]) {
    if (key in entry && entry[key] !== undefined && typeof entry[key] !== "string") return false;
  }
  return true;
}

export class AiCache {
  private readonly directory: string;

  constructor(private readonly root: string, private readonly config: FabricConfig) {
    this.directory = path.join(root, ".fabric-lite", "cache");
  }

  async get(request: NormalizedAiRequest): Promise<CacheEntry | undefined> {
    if (!this.config.cache.enabled) return undefined;
    try {
      const value: unknown = JSON.parse(await readFile(cacheFilePath(this.root, cacheKey(request, this.config)), "utf8"));
      if (!isCacheEntry(value)) return undefined;
      if (this.config.cache.ttlMs > 0 && Date.now() - value.storedAt > this.config.cache.ttlMs) return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  async set(request: NormalizedAiRequest, entry: CacheEntry): Promise<void> {
    if (!this.config.cache.enabled) return;
    let temporary: string | undefined;
    try {
      const key = cacheKey(request, this.config);
      const target = cacheFilePath(this.root, key);
      temporary = path.join(this.directory, `.${key}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
      await mkdir(this.directory, { recursive: true });
      await this.evict();
      await writeFile(temporary, JSON.stringify(entry), "utf8");
      await rename(temporary, target);
    } catch {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }

  private async evict(): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(this.directory)).filter((file) => file.endsWith(".json"));
    } catch {
      return;
    }
    if (files.length < this.config.cache.maxEntries) return;
    const entries = await Promise.all(files.map(async (file) => {
      const filePath = path.join(this.directory, file);
      try {
        const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
        if (isCacheEntry(parsed)) return { file, age: parsed.storedAt };
      } catch {
        // Fall back to mtime for corrupt or unreadable entries.
      }
      try {
        return { file, age: (await stat(filePath)).mtimeMs };
      } catch {
        return { file, age: Number.POSITIVE_INFINITY };
      }
    }));
    entries.sort((a, b) => a.age - b.age);
    let count = files.length;
    for (const entry of entries) {
      if (count < this.config.cache.maxEntries) break;
      try {
        await unlink(path.join(this.directory, entry.file));
        count--;
      } catch {
        // Cache eviction is best effort and must not affect the AI call.
      }
    }
  }
}