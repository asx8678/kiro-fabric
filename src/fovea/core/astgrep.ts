import { owned } from "./context.js";
// Derived from pi-fovea b594483868d27b7eb37a9b185c59ce812f8a9c01 (MIT); see UPSTREAM-LICENSE.txt.
// Thin runner over the ast-grep CLI. All extraction goes through here.
// Executable authority is the host-verified generation descriptor only.
// No PATH or workspace environment parser selection in the native runtime.
//
// Everything is async and gated: a cold build fans chunk invocations out to
// SPAWN_CONCURRENCY processes instead of serializing spawnSync behind the
// TUI's event loop; the loop never stalls waiting on a child process.

import { execFile, spawn } from "node:child_process";
import { context, safeEnvironment } from "./context.js";
import { withScanRuleFile } from "./temp-storage.js";
import { SPAWN_CONCURRENCY, envInt, mapLimit, spawnGate } from "./asyncutil.js";

export const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "Tsx", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "Tsx", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  bend: "Bend", // Native source reader; never sent to ast-grep patterns.
  // Second tier: symbols via ast-grep outline; name derivation is heuristic.
  ex: "Elixir", exs: "Elixir",
  rb: "Ruby",
  c: "C", h: "C",
  cc: "C++", cpp: "C++", cxx: "C++", hpp: "C++", hh: "C++",
  java: "Java",
  kt: "Kotlin", kts: "Kotlin",
  lua: "Lua",
  php: "Php",
  swift: "Swift",
  scala: "Scala",
  hs: "Haskell",
  sh: "Bash",
};

// Compiled artifacts masquerading as source extensions.
const BINARY_EXTS = new Set(["beam", "pyc", "o", "obj", "so", "a", "d"]);
export const isBinaryExt = (file: string): boolean =>
  BINARY_EXTS.has(file.split(".").pop()?.toLowerCase() ?? "");

// Non-code files: literals are regex-extracted so config/spec files can join.
const CONFIG_EXTS = new Set([
  "yaml", "yml", "json", "toml", "env", "tf", "hcl", "md",
  // Parsed by the exact protocol readers; kept out of ast-grep language scans.
  "proto", "graphql", "gql",
]);

export interface AgMatch {
  file: string;                    // as passed to ast-grep (repo-relative)
  line: number;                    // 1-indexed
  column?: number | undefined;
  text: string;                    // full matched node text
  single: Record<string, string>;  // $VAR -> text (single metavars)
  /** Line (1-indexed) of each single capture; 0 when the raw match lacks ranges. */
  singleLines: Record<string, number>;
  multi: Record<string, Array<{ text: string; line: number }>>; // $$$VAR -> occurrences
}

interface ScanConstraint {
  regex?: (string) | undefined;
  not?: (ScanConstraint) | undefined;
  all?: (ScanConstraint[]) | undefined;
}

export interface ScanRule {
  id: string;
  language: string;
  pattern: string;
  constraints?: (Record<string, ScanConstraint>) | undefined;
}

export interface ScanMatch extends AgMatch {
  ruleId: string;
}

/** Drop redundant named variadic captures while preserving matching and match text. */
export const anonymousVariadics = (pattern: string): string =>
  pattern.replace(/\$\$\$[A-Za-z_][A-Za-z0-9_]*/g, () => "$$$");

// ast-grep rejects an entire rules.yml when any rule's `constraints` name a
// metavar its pattern never defines (exit 8, "Undefined meta var"): one stale
// rule voids the consolidated scan for the whole batch, and extraction
// silently reroutes onto per-pattern spawns that re-parse every file for
// every pattern. Patterns are authoritative, so constraints referencing
// absent metavars are dead weight — filter them where rules are produced
// (anchorScanPlan) and again where the rule file is written.
const metavarIn = (pattern: string, key: string): boolean => {
  for (let i = pattern.indexOf(`$${key}`); i >= 0; i = pattern.indexOf(`$${key}`, i + 1)) {
    if (!/[\w$]/.test(pattern[i + 1 + key.length] ?? "")) return true;
  }
  return false;
};

export const liveConstraints = (
  pattern: string,
  constraints: NonNullable<ScanRule["constraints"]>,
): ScanRule["constraints"] => {
  const out: NonNullable<ScanRule["constraints"]> = {};
  for (const [key, constraint] of Object.entries(constraints)) {
    if (metavarIn(pattern, key)) out[key] = constraint;
  }
  return Object.keys(out).length ? out : undefined;
};

const binary = (): string => context().parserPath;
const FAILURE_TTL_MS = 15_000;
export const hasAstGrepAsync = async (): Promise<boolean> => !!binary();

// Import-file argument lists on Windows cap around 8k chars; keep chunks
// conservative. Extraction batches align to this boundary so each consolidated
// scan normally pays one process.
export const AST_GREP_CHUNK = envInt("FOVEA_AST_GREP_CHUNK", 160, 32, 2048);

// Extraction honesty ledger: a failed ast-grep invocation implicates every
// file in its chunk. build.ts drains this once per fact pass and folds it
// into the extraction report surfaced by tools, /fovea status, `fovea status`.
export interface ExtractionFailure {
  op: "outline" | "outline-structured" | "run";
  lang?: (string) | undefined;
  files: string[];
}
const failures = owned("extractionFailures", () => [] as ExtractionFailure[]);
const recordFailure = (op: ExtractionFailure["op"], files: string[], lang?: string): void => {
  failures.push({ op, lang, files });
};
export const drainExtractionFailures = (): ExtractionFailure[] => failures.splice(0, failures.length);

const RUN_TIMEOUT = 120_000;
// 160-file chunks answer a few MB typically; the cap exists so a pathological
// JSON dump fails one chunk instead of inflating the gate's resident set.
const RUN_MAX_BUFFER = 16 * 1024 * 1024;

interface RunResult { ok: boolean; stdout: string; split: boolean }

const run = async (args: string[], cwd: string): Promise<RunResult> =>
  spawnGate.run(
    () =>
      new Promise<RunResult>((resolve) => {
        execFile(
          binary(),
          args,
          { cwd, signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), encoding: "utf8", timeout: RUN_TIMEOUT, maxBuffer: RUN_MAX_BUFFER },
          (error, stdout, stderr) => {
            // A maxBuffer breach is a memory guard, not an extraction error:
            // rerun smaller chunks until each response fits the same ceiling.
            if (error && (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.code === "E2BIG")) {
              resolve({ ok: false, stdout: "", split: true });
              return;
            }
            // Spawn errors surface a non-numeric code (ENOENT/EACCES); a
            // numeric code is a real process exit. Killed/signaled = timeout.
            if (error && typeof error.code !== "number") {
              resolve({ ok: false, stdout: "", split: false });
              return;
            }
            const status = (error && typeof error.code === "number" ? error.code : 0) as number;
            if (status !== 0) {
              // grep convention: `ast-grep run` exits 1 silently on zero
              // matches, so a bare non-zero status is not a failure. Only a
              // verbose one is.
              if ((stderr ?? "").trim()) {
                resolve({ ok: false, stdout: "", split: false });
                return;
              }
              resolve({ ok: true, stdout: "", split: false });
              return;
            }
            resolve({ ok: true, stdout: stdout ?? "", split: false });
          },
        );
      }),
  );

export const langOf = (file: string): string | undefined => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext];
};

export const isConfigFile = (file: string): boolean => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONFIG_EXTS.has(ext);
};

export const groupByLang = (files: string[]): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const f of files) {
    const lang = langOf(f);
    if (!lang) continue;
    const arr = m.get(lang) ?? [];
    arr.push(f);
    m.set(lang, arr);
  }
  return m;
};

// `ast-grep outline` is the uniform symbol source across languages.
// Expanded JSON is primary; the legacy text view remains as a compatibility fallback.
interface OutlineRange {
  start: { line: number; column: number };
  end?: ({ line: number; column: number }) | undefined;
}

export interface OutlineSymbol {
  role: "item" | "member";
  symbolType: string;
  name: string;
  range: OutlineRange;
  signature: string;
  astKind?: (string) | undefined;
  members?: (OutlineSymbol[]) | undefined;
}

export interface OutlineFile {
  path: string;
  language: string;
  items: OutlineSymbol[];
}

// Chunks of one stage fan out concurrently, bounded by the shared spawn gate.
// Order is preserved (mapLimit keeps indices) so concatenated text output
// stays deterministic for the outline parser.
const runChunked = async (
  files: string[],
  chunkArgs: (chunk: string[]) => string[],
  cwd: string,
): Promise<Array<{ chunk: string[]; result: RunResult }>> => {
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += AST_GREP_CHUNK) chunks.push(files.slice(i, i + AST_GREP_CHUNK));
  const adaptive = async (chunk: string[]): Promise<Array<{ chunk: string[]; result: RunResult }>> => {
    const result = await run(chunkArgs(chunk), cwd);
    if (!result.split || chunk.length === 1) return [{ chunk, result }];
    const middle = Math.ceil(chunk.length / 2);
    const halves = await Promise.all([
      adaptive(chunk.slice(0, middle)),
      adaptive(chunk.slice(middle)),
    ]);
    return [...halves[0], ...halves[1]];
  };
  const settled = await mapLimit(chunks, SPAWN_CONCURRENCY, adaptive);
  return settled.flat();
};

// Expanded JSON preserves each member's own range and signature. Return
// undefined when the installed ast-grep predates this interface so callers can
// fall back without presenting parent locations as exact member locations.
export const outlineStructured = async (files: string[], _lang: string, cwd: string): Promise<OutlineFile[] | undefined> => {
  const out: OutlineFile[] = [];
  // A subprocess failure here is NOT recorded: extractSymbols falls back to
  // the text outline for old ast-grep versions, and that text run is what
  // records a genuine failure (old versions must not read as failures).
  const settled = await runChunked(
    files,
    (chunk) => ["outline", "--json=compact", "--view=expanded", "--", ...chunk],
    cwd,
  );
  // Requested-position index for membership checks and ordering; hoisted
  // because it depends only on the full requested list, not any chunk.
  const positions = new Map(files.map((file, i) => [file, i]));
  for (const { result } of settled) {
    // Probe-verified (tests/fovea/outline-structured.test.ts): a real
    // ast-grep exits 0 with non-empty JSON even for symbol-less or
    // unparseable files (`items: []`), so an empty or failed result can
    // only mean the structured interface is unavailable (old ast-grep,
    // spawn error, or a silent non-zero exit). Demote the batch to the
    // text outline: the fallback records the genuine failure there and
    // still recovers symbols when the text interface works. A failed
    // run's stdout is never parsed.
    if (!result.ok || !result.stdout.trim()) return undefined;
    try {
      const parsed = JSON.parse(result.stdout) as OutlineFile[];
      if (!Array.isArray(parsed)) return undefined;
      if (parsed.some(file => !positions.has(file.path))) return undefined;
      parsed.sort((a, b) => positions.get(a.path)! - positions.get(b.path)!);
      for (const file of parsed) out.push(file);
    } catch {
      return undefined;
    }
  }
  return out;
};

export const outline = async (files: string[], lang: string, cwd: string): Promise<string> => {
  let out = "";
  const settled = await runChunked(files, (chunk) => ["outline", "--", ...chunk], cwd);
  for (const { chunk, result } of settled) {
    if (!result.ok) {
      recordFailure("outline", chunk, lang);
      continue;
    }
    out += result.stdout;
  }
  return out;
};

interface RawMatch {
  text: string;
  range: { start: { line: number; column: number } };
  file: string;
  metaVariables?: {
    single?: Record<string, { text: string; range?: { start: { line: number } } | undefined }> | undefined;
    multi?: Record<string, Array<{ text: string; range?: { start: { line: number } } | undefined }>> | undefined;
  } | undefined;
}

interface RawScanMatch extends RawMatch { ruleId: string }
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const canonicalMatchKey = (m: RawMatch): string => JSON.stringify([
  m.text,
  Object.entries(m.metaVariables?.single ?? {}).sort(([a], [b]) => lexical(a, b)).map(([k, v]) => [k, v.text, v.range?.start.line ?? null]),
  Object.entries(m.metaVariables?.multi ?? {}).sort(([a], [b]) => lexical(a, b)).map(([k, v]) => [k, v.map(x => [x.text, x.range?.start.line ?? null])]),
]);
/** Parser scheduling is not semantic order. Preserve EVERY match (duplicates
 * included), but publish in declared rule/source/position order, with outer
 * expressions before inner expressions at the same start. This matches
 * the single-rule oracle schedule without 260 subprocesses per fixture. No
 * graph/fact/result evidence is sorted away by a test normalizer. */
function orderMatches<T extends RawMatch>(matches: T[], files: readonly string[], rules?: readonly ScanRule[]): T[] {
  const paths = new Map(files.map((file, index) => [file, index]));
  const ids = new Map(rules?.map((rule, index) => [rule.id, index]) ?? []);
  if (rules && ids.size !== rules.length) throw new Error('Duplicate parser rule identity');
  const keyed = matches.map(match => {
    const file = paths.get(match.file);
    const rule = rules ? ids.get((match as unknown as RawScanMatch).ruleId) : 0;
    if (file === undefined || rule === undefined || !Number.isSafeInteger(match.range?.start.line) || !Number.isSafeInteger(match.range?.start.column)) throw new Error('Parser match outside declared input');
    return { match, file, rule, key: canonicalMatchKey(match) };
  });
  keyed.sort((a, b) => a.rule - b.rule || a.file - b.file ||
    a.match.range.start.line - b.match.range.start.line || a.match.range.start.column - b.match.range.start.column || b.match.text.length - a.match.text.length || lexical(a.key, b.key));
  return keyed.map(entry => entry.match);
}


const fromRawMatch = (m: RawMatch): AgMatch => {
  const single: Record<string, string> = {};
  const singleLines: Record<string, number> = {};
  const multi: Record<string, Array<{ text: string; line: number }>> = {};
  for (const [key, value] of Object.entries(m.metaVariables?.single ?? {}).sort(([a], [b]) => lexical(a, b))) {
    single[key] = value.text;
    singleLines[key] = value.range ? value.range.start.line + 1 : 0;
  }
  for (const [key, value] of Object.entries(m.metaVariables?.multi ?? {}).sort(([a], [b]) => lexical(a, b)))
    multi[key] = value.map((item) => ({ text: item.text, line: item.range ? item.range.start.line + 1 : 0 }));
  return { file: m.file, line: m.range.start.line + 1, column: m.range.start.column, text: m.text, single, singleLines, multi };
};

const scanSupport = owned('astgrep.ts:scanSupport', () => new Map<string, { ok: boolean; at: number }>());
const scanSupportInflight = owned('astgrep.ts:scanSupportInflight', () => new Map<string, Promise<boolean>>());

const hasRuleScan = (): Promise<boolean> => {
  const bin = binary();
  const hit = scanSupport.get(bin);
  if (hit && (hit.ok || Date.now() - hit.at < FAILURE_TTL_MS)) return Promise.resolve(hit.ok);
  const pending = scanSupportInflight.get(bin);
  if (pending) return pending;
  const probe = spawnGate.run(
    () => new Promise<boolean>((resolve) => {
      execFile(bin, ["scan", "--help"], { signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 }, (error) => {
        resolve(!error);
      });
    }),
  ).then((ok) => {
    scanSupport.set(bin, { ok, at: Date.now() });
    return ok;
  }).finally(() => scanSupportInflight.delete(bin));
  scanSupportInflight.set(bin, probe);
  return probe;
};

const ruleDocuments = (rules: readonly ScanRule[]): string => rules.map(({ id, language, pattern, constraints }) => {
  const live = constraints ? liveConstraints(pattern, constraints) : undefined;
  return JSON.stringify({ id, language, rule: { pattern }, ...(live ? { constraints: live } : {}) });
}).join("\n---\n");

const scanChunk = (
  rulePath: string,
  files: string[],
  cwd: string,
  rules: readonly ScanRule[],
): Promise<ScanMatch[] | undefined> => spawnGate.run(
  () => new Promise<ScanMatch[] | undefined>((resolve) => {
    const child = spawn(
      binary(),
      ["scan", "--rule", rulePath, "--json=stream", "--", ...files],
      { cwd, signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
    );
    const matches: RawScanMatch[] = [];
    let bytes = 0;
    let carry = "";
    let parseFailed = false;
    let timedOut = false;
    let settled = false;
    const finish = (value: ScanMatch[] | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const accept = (line: string): void => {
      if (!line || parseFailed) return;
      try {
        const raw = JSON.parse(line) as RawScanMatch;
        if (!raw.ruleId || !raw.range?.start || typeof raw.file !== "string") {
          parseFailed = true;
          return;
        }
        matches.push(raw);
      } catch {
        parseFailed = true;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > RUN_MAX_BUFFER) { parseFailed = true; child.kill("SIGKILL"); return; }
      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) accept(line);
    });
    child.stderr.resume();
    child.on("error", () => { parseFailed = true; });
    child.on("close", (code) => {
      if (carry.trim()) accept(carry);
      try {
        finish(code === 0 && !timedOut && !parseFailed
          ? orderMatches(matches, files, rules).map(raw => ({ ...fromRawMatch(raw), ruleId: raw.ruleId })) : undefined);
      } catch { finish(undefined); }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT);
    timer.unref?.();
  }),
);

/**
 * Run a mixed-language rule set in one ast-grep parse per file chunk.
 * Undefined means the optimized interface was unavailable or failed; callers
 * then use the legacy per-pattern path, preserving compatibility and partial
 * extraction behavior for malformed repository rules.
 */
export const scanRules = async (
  rules: readonly ScanRule[],
  files: string[],
  cwd: string,
): Promise<ScanMatch[] | undefined> => {
  if (!rules.length || !files.length) return [];
  if (!(await hasRuleScan())) return undefined;
  try {
    return await withScanRuleFile(ruleDocuments(rules), async (rulePath) => {
      const chunks: string[][] = [];
      for (let i = 0; i < files.length; i += AST_GREP_CHUNK) {
        chunks.push(files.slice(i, i + AST_GREP_CHUNK));
      }
      const settled = await mapLimit(chunks, SPAWN_CONCURRENCY, (chunk) =>
        scanChunk(rulePath, chunk, cwd, rules).catch(() => undefined),
      );
      if (settled.some((matches) => matches === undefined)) return undefined;
      const out: ScanMatch[] = [];
      for (const matches of settled) for (const match of matches!) out.push(match);
      return out;
    });
  } catch {
    return undefined;
  }
};

// `ast-grep run --pattern` with JSON output for a set of files of one language.
const patternRun = async (
  pattern: string,
  lang: string,
  files: string[],
  cwd: string,
): Promise<AgMatch[]> => {
  const out: AgMatch[] = [];
  const settled = await runChunked(
    files,
    (chunk) => ["run", "--pattern", pattern, "--lang", lang, "--json=compact", "--", ...chunk],
    cwd,
  );
  for (const { chunk, result } of settled) {
    if (!result.ok) {
      recordFailure("run", chunk, lang);
      continue;
    }
    if (!result.stdout.trim()) continue;
    let parsed: RawMatch[];
    try {
      parsed = JSON.parse(result.stdout) as RawMatch[];
    } catch {
      recordFailure("run", chunk, lang);
      continue;
    }
    if (!Array.isArray(parsed)) {
      recordFailure("run", chunk, lang);
      continue;
    }
    try { const ordered = orderMatches(parsed, chunk).map(fromRawMatch); for (const match of ordered) out.push(match); }
    catch { recordFailure("run", chunk, lang); }
  }
  return out;
};

// First match of any of the patterns, per language/file set, concatenated.
// Patterns run concurrently (bounded by the spawn gate): per-stage latency
// collapses from O(patterns * chunks) processes-sequential to ~the slowest
// slice of chunks wide SPAWN_CONCURRENCY.
export const patternRunAll = async (
  patterns: string[],
  lang: string,
  files: string[],
  cwd: string,
): Promise<AgMatch[]> => {
  const perPattern = await mapLimit(patterns, patterns.length || 1, (p) => patternRun(p, lang, files, cwd));
  const out: AgMatch[] = [];
  for (const matches of perPattern) for (const m of matches) out.push(m);
  return out;
};
