import type { CheckResult, Diagnostic } from "../checker.js";
import type { RunEnvelope } from "../runtime/executor.js";

export interface RenderStream {
  isTTY?: boolean;
}

export interface RenderOptions {
  color?: boolean;
  stream?: RenderStream;
  highlight?: boolean;
}

export interface DisplayMeta {
  name?: string;
  description?: string;
}

export interface CallEvent {
  at?: string;
  role?: string;
  repair?: boolean;
  requestedModel?: string | null;
  resolvedModel?: string | null;
  resolutionSource?: string;
  inputChars?: number;
  outputChars?: number;
  elapsedMs?: number;
  exitCode?: number;
  instructionSha256?: string;
}

export interface RenderDiagnostic extends Partial<Diagnostic> {
  code?: number;
  category?: "error" | "warning";
  message: string;
  line: number;
  column: number;
  sourceLine?: string;
}

const MAX_PROGRAM_LINES = 200;
const MAX_FORMATTED_VALUE = 20_000;

export function colorEnabled(stream: RenderStream = process.stdout, override?: boolean): boolean {
  if (override !== undefined) return override;
  return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

function ansi(code: string, text: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export function dim(text: string, enabled = colorEnabled()): string {
  return ansi("2", text, enabled);
}
export function bold(text: string, enabled = colorEnabled()): string {
  return ansi("1", text, enabled);
}
export function red(text: string, enabled = colorEnabled()): string {
  return ansi("31", text, enabled);
}
export function green(text: string, enabled = colorEnabled()): string {
  return ansi("32", text, enabled);
}
export function yellow(text: string, enabled = colorEnabled()): string {
  return ansi("33", text, enabled);
}
export function cyan(text: string, enabled = colorEnabled()): string {
  return ansi("36", text, enabled);
}

// Gold accent (256-color) used for the fabric-lite brand, section rules,
// gutters, success glyphs, and retry markers across all run interaction.
const GOLD = "38;5;220";
export function gold(text: string, enabled = colorEnabled()): string {
  return ansi(GOLD, text, enabled);
}
export function goldBold(text: string, enabled = colorEnabled()): string {
  return ansi(`1;${GOLD}`, text, enabled);
}
export function goldDim(text: string, enabled = colorEnabled()): string {
  return ansi(`2;${GOLD}`, text, enabled);
}

function renderColor(options: RenderOptions = {}, stream: RenderStream = process.stdout): boolean {
  return colorEnabled(options.stream ?? stream, options.color);
}

export function parseDisplayMeta(body: string): DisplayMeta {
  const meta: DisplayMeta = {};
  const lines = body.split(/\r?\n/).slice(0, 10);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const name = /^\s*\/\/\s*@name:\s*(.*?)\s*$/.exec(line);
    const description = /^\s*\/\/\s*@description:\s*(.*?)\s*$/.exec(line);
    if (name?.[1]) meta.name = name[1];
    if (description?.[1]) meta.description = description[1];
    if (!line.trimStart().startsWith("//")) break;
  }
  return meta;
}

function bodyLines(body: string): string[] {
  return body.split(/\r?\n/);
}

function gutterWidth(body: string): number {
  return Math.max(3, String(bodyLines(body).length).length);
}

function highlightedLine(line: string, enabled: boolean): string {
  if (!enabled) return line;
  const tokenPattern =
    /(\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|return|async|await|if|else|for|while|function|new|true|false|null|undefined|class|type|interface|extends|try|catch|throw)\b)/g;
  return line.replace(tokenPattern, (token) => {
    if (token.startsWith("//")) return dim(token, true);
    if (/^["'`]/.test(token)) return yellow(token, true);
    return cyan(token, true);
  });
}

function numberedLine(line: string, number: number, width: number, options: RenderOptions): string {
  const colored = renderColor(options);
  const gutter = goldDim(`${String(number).padStart(width)} │`, colored);
  return `${gutter} ${highlightedLine(line, Boolean(options.highlight) && colored)}`;
}

export function renderProgram(body: string, options: RenderOptions = {}): string {
  const lines = bodyLines(body);
  const width = gutterWidth(body);
  const output = lines
    .slice(0, MAX_PROGRAM_LINES)
    .map((line, index) => numberedLine(line, index + 1, width, options));
  if (lines.length > MAX_PROGRAM_LINES)
    output.push(`… ${lines.length - MAX_PROGRAM_LINES} more lines`);
  return output.join("\n");
}

function diagnosticLabel(diagnostic: RenderDiagnostic): string {
  const category = diagnostic.category ?? "error";
  const code = diagnostic.code === undefined ? "" : ` TS${diagnostic.code}`;
  return `${category}${code}: ${diagnostic.message}`;
}

function diagnosticStyle(diagnostic: RenderDiagnostic, text: string, enabled: boolean): string {
  return diagnostic.category === "warning" ? yellow(text, enabled) : red(text, enabled);
}

export function renderDiagnostics(
  diagnostics: readonly RenderDiagnostic[],
  body: string,
  options: RenderOptions = {},
): string {
  const lines = bodyLines(body);
  const width = gutterWidth(body);
  const colored = renderColor(options);
  return diagnostics
    .map((diagnostic) => {
      const source = diagnostic.sourceLine ?? lines[diagnostic.line - 1] ?? "";
      const number = Math.max(1, diagnostic.line);
      const sourceGutter = goldDim(`${String(number).padStart(width)} │`, colored);
      const caretGutter = goldDim(`${" ".repeat(width)} │`, colored);
      const caret = `${caretGutter} ${" ".repeat(Math.max(0, diagnostic.column - 1))}${diagnosticStyle(diagnostic, "^", colored)}`;
      return `${diagnosticStyle(diagnostic, diagnosticLabel(diagnostic), colored)}\n${sourceGutter} ${source}\n${caret}`;
    })
    .join("\n");
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (value === "") return '""';
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return JSON.stringify(value) ?? String(value);
}

function isMultilineString(value: unknown): value is string {
  return typeof value === "string" && value.includes("\n");
}

function renderNode(value: unknown, indent: number, ancestors: Set<object>): string[] {
  const pad = " ".repeat(indent);
  if (isMultilineString(value))
    return [`${pad}|`, ...value.split("\n").map((line) => `${pad}  ${line}`)];
  if (value === null || typeof value !== "object") return [`${pad}${scalar(value)}`];
  if (ancestors.has(value)) return [`${pad}[Circular]`];
  ancestors.add(value);
  let result: string[];
  if (Array.isArray(value)) {
    if (value.length === 0) result = [`${pad}[]`];
    else
      result = value.flatMap((item) => {
        if (isMultilineString(item))
          return [
            `${pad}- |`,
            ...item.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`),
          ];
        if (item !== null && typeof item === "object")
          return [`${pad}-`, ...renderNode(item, indent + 2, ancestors)];
        return [`${pad}- ${scalar(item)}`];
      });
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) result = [`${pad}{}`];
    else {
      result = [];
      for (const [key, item] of entries) {
        if (isMultilineString(item)) {
          result.push(
            `${pad}${key}: |`,
            ...item.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`),
          );
        } else if (item !== null && typeof item === "object") {
          result.push(`${pad}${key}:`, ...renderNode(item, indent + 2, ancestors));
        } else {
          result.push(`${pad}${key}: ${scalar(item)}`);
        }
      }
    }
  }
  ancestors.delete(value);
  return result;
}

export function formatValue(value: unknown): string {
  const lines = renderNode(value, 0, new Set<object>());
  const rendered = lines.join("\n");
  if (rendered.length <= MAX_FORMATTED_VALUE) return rendered;
  const notice = "\n… output truncated …";
  return `${rendered.slice(0, MAX_FORMATTED_VALUE - notice.length)}${notice}`;
}

function elapsed(elapsedMs: unknown): string | undefined {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return undefined;
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`;
  return `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`;
}

function lineCount(body: string): number {
  return bodyLines(body).length;
}

function diagnosticArray(value: unknown): RenderDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RenderDiagnostic => {
    if (typeof item !== "object" || item === null) return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.message === "string" &&
      typeof candidate.line === "number" &&
      typeof candidate.column === "number"
    );
  });
}

function rule(label: string, colored: boolean, failed = false): string {
  const text = `─ ${label} ${"─".repeat(Math.max(4, 61 - label.length))}`;
  return failed ? red(text, colored) : gold(text, colored);
}

export function formatRunStart(
  input: { runId: string; body: string },
  options: RenderOptions = {},
): string {
  const colored = renderColor(options, process.stderr);
  const meta = parseDisplayMeta(input.body);
  const name = meta.name ? ` ${gold(meta.name, colored)}` : "";
  return `${goldBold("▸ fabric-lite", colored)} ${dim(input.runId, colored)}${name} ${dim(`· running ${lineCount(input.body)} lines…`, colored)}`;
}

export function renderRunText(
  input: { body: string; envelope: RunEnvelope },
  options: RenderOptions = {},
): string {
  const { body, envelope } = input;
  const colored = renderColor(options);
  const meta = parseDisplayMeta(body);
  const metrics = envelope.metrics as
    { elapsedMs?: number; aiCalls?: number; retries?: number } | undefined;
  const brand = `${goldBold("▸ fabric-lite", colored)} ${dim(envelope.runId, colored)}`;
  const headerFields = [brand];
  if (meta.name) headerFields.push(gold(meta.name, colored));
  headerFields.push(dim("TypeScript", colored), dim(`${lineCount(body)} lines`, colored));
  const duration = elapsed(metrics?.elapsedMs);
  if (duration) headerFields.push(dim(duration, colored));
  if (typeof metrics?.aiCalls === "number")
    headerFields.push(
      dim(`${metrics.aiCalls} AI call${metrics.aiCalls === 1 ? "" : "s"}`, colored),
    );
  if (typeof metrics?.retries === "number" && metrics.retries > 0) {
    headerFields.push(
      gold(`${metrics.retries} ${metrics.retries === 1 ? "retry" : "retries"}`, colored),
    );
  }
  const output = [
    headerFields.join(dim(" · ", colored)),
    rule("program", colored),
    renderProgram(body, options),
  ];
  if (envelope.status === "succeeded") {
    output.push(rule("result", colored), formatValue(envelope.value));
  } else {
    const error = envelope.error ?? { code: "RUNTIME_FAILED", message: "Execution failed" };
    output.push(rule("error", colored, true), red(`✗ ${error.code}: ${error.message}`, colored));
    const diagnostics = diagnosticArray(error.diagnostics);
    if (diagnostics.length) output.push(renderDiagnostics(diagnostics, body, options));
  }
  return output.join("\n");
}

export function renderCheckText(
  result: CheckResult,
  body: string,
  options: RenderOptions = {},
): string {
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.category === "warning");
  const colored = renderColor(options);
  if (result.ok) {
    const output = [`${gold("✓", colored)} program valid · ${lineCount(body)} lines`];
    if (warnings.length) output.push(renderDiagnostics(warnings, body, options));
    return output.join("\n");
  }
  const output = [red("✗ type check failed", colored)];
  if (result.diagnostics.length) output.push(renderDiagnostics(result.diagnostics, body, options));
  return output.join("\n");
}

export function formatCallEvent(event: CallEvent, options: RenderOptions = {}): string {
  const failed = typeof event.exitCode === "number" && event.exitCode !== 0;
  const repair = event.repair === true;
  const glyph = failed ? "✗" : repair ? "↻" : "›";
  const role = event.role ?? "worker";
  const inputChars = event.inputChars ?? 0;
  const outputChars = event.outputChars ?? 0;
  const duration = elapsed(event.elapsedMs) ?? "?";
  const text = `${glyph} ${role} · ${inputChars} in · ${outputChars} out · ${duration}${repair ? " · repair" : ""}`;
  const colored = renderColor(options, process.stderr);
  if (failed) return red(text, colored);
  if (repair) return gold(text, colored);
  return `${gold(glyph, colored)} ${dim(text.slice(glyph.length + 1), colored)}`;
}
