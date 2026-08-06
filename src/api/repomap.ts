import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ContextFocusResult,
  ContextImpactResult,
  ContextSketchResult,
  FabricLiteApi,
} from "../../types/fabric-lite.js";
import { argumentRecord, invalidArguments, optionalNumber, requiredString } from "./args.js";
import { denied } from "./paths.js";
import type { ApiContext } from "./context.js";

/**
 * Deterministic, token-budgeted repo mapping (pi-fovea style) for
 * programmatic context selection: a cheap silhouette of the whole repo
 * (sketch), sharp detail near a query (focus), and blast radius (impact).
 * No LLM calls; every result carries content hashes so callers can compose
 * them into AI-call contexts whose cache keys change exactly when the code
 * changes. One lazily-built scan is shared by all three calls within a run.
 */

type Lang = "ts" | "js" | "py" | "go" | "rs" | "java" | "rb";

const EXTENSION_LANG: Record<string, Lang> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java",
  ".kt": "java",
  ".cs": "java",
  ".swift": "java",
  ".scala": "java",
  ".rb": "rb",
};

const MAX_SCAN_FILES = 2000;
const MAX_FILE_CHARS = 64_000;
const MAX_TOTAL_CHARS = 2_000_000;
const MAX_SYMBOLS_PER_FILE = 12;
const SIGNATURE_CHARS = 160;
const READ_BATCH = 16;

interface SymbolRule {
  kind: string;
  pattern: RegExp;
  nameIndex?: number;
}

const TS_RULES: SymbolRule[] = [
  {
    kind: "function",
    pattern: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "class",
    pattern: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  },
  { kind: "interface", pattern: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "enum", pattern: /^\s*export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: "variable",
    pattern: /^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  },
  { kind: "function", pattern: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
];

const SYMBOL_RULES: Record<Lang, SymbolRule[]> = {
  ts: TS_RULES,
  js: TS_RULES.filter((rule) => rule.kind !== "interface" && rule.kind !== "type"),
  py: [
    { kind: "function", pattern: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
    { kind: "class", pattern: /^class\s+([A-Za-z_]\w*)/ },
  ],
  go: [
    { kind: "function", pattern: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
    { kind: "type", pattern: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/ },
  ],
  rs: [
    { kind: "function", pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { kind: "type", pattern: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/ },
  ],
  java: [
    {
      kind: "type",
      pattern:
        /^\s*(?:@[A-Za-z]+\s*)*(?:(?:public|protected|private|abstract|final|static|sealed)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/,
    },
  ],
  rb: [
    { kind: "function", pattern: /^\s*def\s+([A-Za-z_]\w*)/ },
    { kind: "type", pattern: /^\s*(?:class|module)\s+([A-Za-z_]\w*)/ },
  ],
};

interface RepoSymbol {
  name: string;
  kind: string;
  line: number;
  signature: string;
}

interface RepoFile {
  path: string;
  bytes: number;
  hash: string;
  content: string;
  symbols: RepoSymbol[];
  /** Import specifiers: project-relative module ids for relative imports, raw specifiers otherwise. */
  imports: string[];
}

interface RepoScan {
  files: RepoFile[];
  repoHash: string;
  truncated: boolean;
  totalCandidates: number;
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 10);

const MODULE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|swift|scala|rb)$/i;

/** Canonical module id for dependency matching: lowercase, no extension, no trailing /index. */
function moduleId(spec: string): string {
  let id = spec.replaceAll("\\", "/").replace(MODULE_EXT, "").toLowerCase();
  if (id.endsWith("/index")) id = id.slice(0, -"/index".length);
  return id;
}

function extractSymbols(content: string, lang: Lang): RepoSymbol[] {
  const rules = SYMBOL_RULES[lang];
  const symbols: RepoSymbol[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    for (const rule of rules) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const name = match[rule.nameIndex ?? 1];
      if (!name) continue;
      const signature = line
        .trim()
        .replace(/\s*[{(:]?\s*$/, "")
        .slice(0, SIGNATURE_CHARS);
      symbols.push({ name, kind: rule.kind, line: index + 1, signature });
      break;
    }
  }
  return symbols;
}

function extractImports(content: string, lang: Lang, fileDir: string): string[] {
  const specs = new Set<string>();
  const record = (spec: string): void => {
    if (spec.startsWith(".")) {
      const resolved = path.posix.normalize(path.posix.join(fileDir, spec));
      if (!resolved.startsWith("..") && resolved !== "..") specs.add(resolved);
    } else {
      specs.add(spec.replaceAll("::", "/").replaceAll(".", "/"));
    }
  };
  if (lang === "ts" || lang === "js") {
    const pattern =
      /(?:\bimport\b[^'";]*?\bfrom\s*|\bimport\s*|\bexport\b[^'";]*?\bfrom\s*|\brequire\()\s*['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(pattern)) record(match[1]!);
  } else if (lang === "py") {
    const pattern =
      /^\s*(?:from\s+([.A-Za-z_]\w*(?:\.[\w]+)*)\s+import\s|import\s+([A-Za-z_]\w*(?:\.[\w]+)*))/gm;
    for (const match of content.matchAll(pattern)) record(match[1] ?? match[2]!);
  } else if (lang === "go") {
    const pattern = /^\s*(?:[\w.]+\s+)?"([\w./-]+\/[^"]+)"\s*$/gm;
    for (const match of content.matchAll(pattern)) specs.add(match[1]!);
  } else if (lang === "rs") {
    const pattern = /^\s*use\s+([\w:]+)/gm;
    for (const match of content.matchAll(pattern)) record(match[1]!.replace(/^crate::/, "./"));
  }
  return [...specs].sort();
}

const isTestFile = (rel: string): boolean =>
  /(^|\/)(tests?|__tests__|spec|testdata|fixtures?)(\/|$)/i.test(rel) ||
  /\.(test|spec)\.[^.]+$/i.test(rel);

async function scanRepo(root: string): Promise<RepoScan> {
  const candidates: string[] = [];
  let truncated = false;
  let totalCandidates = 0;
  async function visit(dirRel: string): Promise<void> {
    if (candidates.length >= MAX_SCAN_FILES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dirRel ? path.join(root, dirRel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (candidates.length >= MAX_SCAN_FILES) {
        truncated = true;
        return;
      }
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (denied.test(rel) || denied.test(`${rel}/`)) continue;
        await visit(rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!(ext in EXTENSION_LANG) || denied.test(rel)) continue;
        totalCandidates++;
        candidates.push(rel);
      }
    }
  }
  await visit("");

  const files: RepoFile[] = [];
  let totalChars = 0;
  for (let offset = 0; offset < candidates.length; offset += READ_BATCH) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    const batch = candidates.slice(offset, offset + READ_BATCH);
    const contents = await Promise.all(
      batch.map(async (rel) => {
        try {
          return await readFile(path.join(root, rel), "utf8");
        } catch {
          return undefined;
        }
      }),
    );
    for (let index = 0; index < batch.length; index++) {
      let content = contents[index];
      if (content === undefined) continue;
      const rel = batch[index]!;
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS);
        truncated = true;
      }
      totalChars += content.length;
      const lang = EXTENSION_LANG[path.extname(rel).toLowerCase()]!;
      files.push({
        path: rel,
        bytes: content.length,
        hash: sha1(content),
        content,
        symbols: extractSymbols(content, lang),
        imports: extractImports(content, lang, path.posix.dirname(rel)),
      });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const repoHash = createHash("sha256")
    .update(files.map((file) => `${file.path}:${file.hash}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { files, repoHash, truncated, totalCandidates };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function middleTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n… [${text.length - maxChars} chars omitted] …\n`;
  const budget = Math.max(1, maxChars - marker.length);
  const head = Math.ceil(budget / 2);
  return `${text.slice(0, head)}${marker}${text.slice(Math.max(head, text.length - Math.floor(budget / 2)))}`;
}

function boundedChars(ref: string, value: unknown, fallback: number, cap: number): number {
  optionalNumber(ref, value, "maxChars");
  if (value === undefined) return fallback;
  const n = value as number;
  if (!Number.isInteger(n) || n < 200) invalidArguments(ref, "maxChars must be an integer >= 200");
  return Math.min(n, cap);
}

export function createContextApi(ctx: ApiContext): FabricLiteApi["context"] {
  const { root } = ctx;
  let cached: Promise<RepoScan> | undefined;
  const scan = (): Promise<RepoScan> => (cached ??= scanRepo(root));

  async function sketch(input: unknown): Promise<ContextSketchResult> {
    const request = argumentRecord("fabric.context.sketch", input ?? {});
    const maxChars = boundedChars("fabric.context.sketch", request.maxChars, 6000, 100_000);
    if (request.includeTests !== undefined && typeof request.includeTests !== "boolean")
      invalidArguments("fabric.context.sketch", "includeTests must be a boolean");
    const includeTests = request.includeTests === true;
    const data = await scan();
    const prod = data.files.filter((file) => !isTestFile(file.path));
    const tests = data.files.filter((file) => isTestFile(file.path));

    const render = (files: RepoFile[], signatures: boolean, symbols: boolean): string[] => {
      const lines: string[] = [];
      for (const file of files) {
        lines.push(`${file.path} (${file.bytes}b #${file.hash})`);
        if (!symbols) continue;
        for (const symbol of file.symbols.slice(0, MAX_SYMBOLS_PER_FILE)) {
          lines.push(
            `  L${symbol.line} ${symbol.kind} ${signatures ? symbol.signature : symbol.name}`,
          );
        }
        if (file.symbols.length > MAX_SYMBOLS_PER_FILE)
          lines.push(`  … ${file.symbols.length - MAX_SYMBOLS_PER_FILE} more symbols`);
      }
      return lines;
    };

    let outline = "";
    let truncated = data.truncated;
    for (const [signatures, symbols] of [
      [true, true],
      [false, true],
      [false, false],
    ] as const) {
      const lines = render(prod, signatures, symbols);
      if (includeTests && tests.length > 0)
        lines.push("[tests]", ...render(tests, signatures, symbols));
      outline = lines.join("\n");
      if (outline.length <= maxChars) break;
      truncated = true;
    }
    if (outline.length > maxChars) {
      outline = middleTruncate(outline, maxChars);
      truncated = true;
    }
    return {
      repoHash: data.repoHash,
      filesScanned: data.files.length,
      totalFiles: data.totalCandidates,
      testFiles: tests.length,
      truncated,
      outline,
    };
  }

  async function focus(input: unknown): Promise<ContextFocusResult> {
    const request = argumentRecord("fabric.context.focus", input);
    const query = requiredString("fabric.context.focus", request.query, "query");
    optionalNumber("fabric.context.focus", request.maxFiles, "maxFiles");
    const maxChars = boundedChars("fabric.context.focus", request.maxChars, 8000, 100_000);
    const maxFiles =
      request.maxFiles === undefined
        ? 8
        : Math.min(Math.max(1, Math.floor(request.maxFiles as number)), 20);
    const tokens = [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9_$]+/)
          .filter((token) => token.length >= 2),
      ),
    ];
    if (tokens.length === 0)
      invalidArguments(
        "fabric.context.focus",
        "query must contain a word of at least 2 characters",
      );
    const data = await scan();

    const scored = data.files
      .map((file) => {
        const lowerPath = file.path.toLowerCase();
        const lowerContent = file.content.toLowerCase();
        const names = file.symbols.map((symbol) => symbol.name.toLowerCase());
        let score = 0;
        for (const token of tokens) {
          if (names.some((name) => name === token)) score += 12;
          else if (names.some((name) => name.includes(token))) score += 6;
          if (lowerPath.includes(token)) score += 4;
          let occurrences = 0;
          let at = lowerContent.indexOf(token);
          while (at >= 0 && occurrences < 3) {
            occurrences++;
            at = lowerContent.indexOf(token, at + token.length);
          }
          score += occurrences;
        }
        return { file, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1));

    let truncated = data.truncated || scored.length > maxFiles;
    const selected = scored.slice(0, maxFiles);
    const buildFiles = (): ContextFocusResult["files"] =>
      selected.map(({ file, score }) => {
        const matching = file.symbols.filter((symbol) =>
          tokens.some((token) => symbol.name.toLowerCase().includes(token)),
        );
        const anchors = matching.slice(0, 3).map((symbol) => ({
          path: file.path,
          startLine: Math.max(1, symbol.line - 15),
          endLine: symbol.line + 30,
        }));
        if (anchors.length === 0) {
          const lines = file.content.split("\n");
          const hit = lines.findIndex((line) =>
            tokens.some((token) => line.toLowerCase().includes(token)),
          );
          if (hit >= 0)
            anchors.push({
              path: file.path,
              startLine: Math.max(1, hit + 1 - 15),
              endLine: hit + 1 + 30,
            });
        }
        return {
          path: file.path,
          score,
          hash: file.hash,
          symbols: matching.slice(0, MAX_SYMBOLS_PER_FILE),
          imports: file.imports,
          suggestedReads: anchors,
        };
      });

    let files = buildFiles();
    while (files.length > 1 && JSON.stringify(files).length > maxChars) {
      selected.pop();
      files = buildFiles();
      truncated = true;
    }
    return {
      repoHash: data.repoHash,
      query,
      filesScanned: data.files.length,
      truncated,
      files,
    };
  }

  async function impact(input: unknown): Promise<ContextImpactResult> {
    const request = argumentRecord("fabric.context.impact", input);
    if (request.path !== undefined && typeof request.path !== "string")
      invalidArguments("fabric.context.impact", "path must be a string");
    if (request.symbol !== undefined && typeof request.symbol !== "string")
      invalidArguments("fabric.context.impact", "symbol must be a string");
    if (request.path === undefined && request.symbol === undefined)
      invalidArguments("fabric.context.impact", "path or symbol is required");
    if (request.transitive !== undefined && typeof request.transitive !== "boolean")
      invalidArguments("fabric.context.impact", "transitive must be a boolean");
    optionalNumber("fabric.context.impact", request.maxResults, "maxResults");
    const maxResults =
      request.maxResults === undefined
        ? 50
        : Math.min(Math.max(1, Math.floor(request.maxResults as number)), 200);
    const wantTransitive = request.transitive !== false;

    let targetRel: string | undefined;
    if (typeof request.path === "string") {
      targetRel = request.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (targetRel.startsWith("..") || path.posix.isAbsolute(targetRel) || denied.test(targetRel))
        invalidArguments(
          "fabric.context.impact",
          "path must stay inside the project and avoid denied locations",
        );
    }
    const symbol = typeof request.symbol === "string" ? request.symbol : undefined;
    const data = await scan();

    const targetId = targetRel ? moduleId(targetRel) : undefined;
    const specMatches = (spec: string, id: string): boolean => {
      const specId = moduleId(spec);
      return specId === id || id.endsWith(`/${specId}`);
    };
    const symbolPattern = symbol ? new RegExp(`\\b${escapeRegExp(symbol)}\\b`) : undefined;

    const direct = new Set<string>();
    for (const file of data.files) {
      if (targetRel && file.path === targetRel) continue;
      if (targetId && file.imports.some((spec) => specMatches(spec, targetId)))
        direct.add(file.path);
      else if (symbolPattern && symbolPattern.test(file.content)) direct.add(file.path);
    }

    const transitive = new Set<string>();
    if (wantTransitive && direct.size > 0) {
      const directIds = new Set([...direct].map((rel) => moduleId(rel)));
      for (const file of data.files) {
        if (direct.has(file.path) || (targetRel && file.path === targetRel)) continue;
        if (file.imports.some((spec) => [...directIds].some((id) => specMatches(spec, id))))
          transitive.add(file.path);
      }
    }

    const directList = [...direct].sort();
    const transitiveList = [...transitive].sort();
    const truncated = directList.length + transitiveList.length > maxResults;
    const keptDirect = directList.slice(0, maxResults);
    const keptTransitive = transitiveList.slice(0, Math.max(0, maxResults - keptDirect.length));
    return {
      repoHash: data.repoHash,
      target: {
        ...(targetRel ? { path: targetRel } : {}),
        ...(symbol ? { symbol } : {}),
      },
      direct: keptDirect,
      transitive: keptTransitive,
      truncated,
    };
  }

  return { sketch, focus, impact };
}
