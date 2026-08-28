import { createTwoFilesPatch } from "diff";
import type { FabricCallAudit } from "../core/action-registry.js";

const MUTATION_REFS = new Set(["k.edit", "k.write"]);
const MAX_DIFFS = 8;
const MAX_DIFF_CHARS = 8_000;

const RESET = "\x1b[0m";
const ADD = "\x1b[32m";
const DEL = "\x1b[31m";
const HUNK = "\x1b[36m";
const META = "\x1b[2m";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const mutationPath = (audit: FabricCallAudit): string => {
  const args = isRecord(audit.args) ? audit.args : undefined;
  return stringOf(args?.path) ?? stringOf(args?.file) ?? stringOf(args?.absolutePath) ?? audit.ref;
};

const writeDiff = (
  audit: FabricCallAudit,
  preview: Record<string, unknown> | undefined,
  previewDetails: Record<string, unknown> | undefined,
): string | undefined => {
  if (audit.ref !== "k.write" || preview?.writeBeforeCaptured !== true) return undefined;
  const after = typeof preview.writeContent === "string" ? preview.writeContent : undefined;
  if (after === undefined) return undefined;
  const beforeValue = preview.codePreviewBeforeWrite ?? previewDetails?.codePreviewBeforeWrite;
  const beforeRecord = isRecord(beforeValue) ? beforeValue : undefined;
  const before = beforeRecord?.kind === "content" && typeof beforeRecord.content === "string"
    ? beforeRecord.content
    : beforeValue === undefined
      ? ""
      : undefined;
  if (before === undefined || before === after) return undefined;
  const displayPath = mutationPath(audit).replace(/^[/\\]+/u, "");
  const patch = createTwoFilesPatch(
    `a/${displayPath}`,
    `b/${displayPath}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );
  return patch.replace(/^={3,}\n/u, "").trimEnd() || undefined;
};

const mutationDiff = (audit: FabricCallAudit): string | undefined => {
  const preview = isRecord(audit.preview) ? audit.preview : undefined;
  const previewDetails = isRecord(preview?.details) ? preview.details : undefined;
  const result = isRecord(audit.result) ? audit.result : undefined;
  const resultDetails = isRecord(result?.details) ? result.details : undefined;
  return stringOf(previewDetails?.diff) ??
    stringOf(resultDetails?.diff) ??
    writeDiff(audit, preview, previewDetails);
};

const countDiff = (diff: string): { additions: number; removals: number } => {
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }
  return { additions, removals };
};

const clipDiff = (diff: string, maxChars: number): string => {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n... diff truncated ...`;
};

export const colorizeUnifiedDiff = (diff: string): string =>
  diff.split("\n").map((line) => {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff ")) {
      return `${META}${line}${RESET}`;
    }
    if (line.startsWith("@@")) return `${HUNK}${line}${RESET}`;
    if (line.startsWith("+") && !line.startsWith("+++")) return `${ADD}${line}${RESET}`;
    if (line.startsWith("-") && !line.startsWith("---")) return `${DEL}${line}${RESET}`;
    return line.startsWith(" ") ? `${META}${line}${RESET}` : line;
  }).join("\n");

/** Colorize mutation diffs already embedded in a returned tool value. */
export const colorizeReturnedMutationDiffs = (
  text: string,
  audits: readonly FabricCallAudit[],
): string => {
  let colored = text;
  for (const audit of audits) {
    if (!MUTATION_REFS.has(audit.ref) || audit.success !== true) continue;
    const diff = mutationDiff(audit);
    if (diff && colored.includes(diff)) {
      colored = colored.replaceAll(diff, colorizeUnifiedDiff(diff));
    }
  }
  return colored;
};

/** Compact ANSI unified diffs for successful k.edit / k.write audits. */
export const formatMutationDiffs = (
  audits: readonly FabricCallAudit[],
  alreadyShown = "",
): string | undefined => {
  const blocks: string[] = [];
  let omitted = 0;
  for (const audit of audits) {
    if (!MUTATION_REFS.has(audit.ref) || audit.success !== true) continue;
    const diff = mutationDiff(audit);
    if (!diff) continue;
    const fingerprint = diff.slice(0, 160);
    if (fingerprint && alreadyShown.includes(fingerprint)) continue;
    if (blocks.length >= MAX_DIFFS) {
      omitted++;
      continue;
    }
    const { additions, removals } = countDiff(diff);
    const header = `${META}${audit.ref} ${mutationPath(audit)}  +${additions} \u2212${removals}${RESET}`;
    blocks.push(`${header}\n${colorizeUnifiedDiff(clipDiff(diff, MAX_DIFF_CHARS))}`);
  }
  if (blocks.length === 0) return undefined;
  const note = omitted > 0 ? `\n${META}+${omitted} more diffs omitted${RESET}` : "";
  return blocks.join("\n\n") + note;
};
