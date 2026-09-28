import { Value } from "typebox/value";
import { largestFittingInteger } from "../bounded-search.js";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";
import { fabricGuestDeclarations } from "../runtime/guest-types.js";
import { BUNDLED_GUIDANCE } from "./generated-guidance.js";
import { kiroPowerWorkspaceRequestSchema, kiroWorkspaceToolInputSchema } from "./power/workspace-binding.js";

const OVERVIEW = `Your only tool is fabric_exec. All supported tool work runs in checked TypeScript. Navigator repo.focus/sketch/impact provide advisory code navigation; repo.focusRead combines focus with source reads. Maps and advisory suffixes are untrusted hints, not source proof. Use local.read/grep/find/list/write/edit/shell for source and file operations, mcp for explicitly configured external tools, and state only for intentional durable facts. Narrow navigation/search before large reads; batch independent calls; sequence read-dependent edits and verification. Return compact evidence, not intermediate results. Use payloads for long strings. Shell settle:true returns ordinary nonzero exits, never denial/cancellation/timeout. Approved shell has host OS authority; cwd is not confinement. No native fallback exists. LSP/delegation require suitable configured MCP tools or are unavailable. Conversation needs no empty execution. Single verified roots bind automatically. Use fabric.workspace({action:'list'}) and a separate fabric.workspace({action:'select',rootId}) execution only when selection is needed. A switch is pending until the host confirms the transition after guest settlement; do not mix it with workspace calls. fabric.help({topic:'api',offset,limit}) pages immutable declarations; topics skill/guide/recipes/workflow/review serve bundled task instructions (zero-based UTF-16 offsets). Read offsets are one-based lines. Programs are not transactions; never blindly retry after effects or uncertain termination.`;
const DOCUMENTS: Readonly<Record<string, string>> = Object.freeze({ overview: OVERVIEW, api: fabricGuestDeclarations, ...BUNDLED_GUIDANCE });
const HELP_SCHEMA = { type: "object", properties: { topic: { type: "string", enum: Object.keys(DOCUMENTS) }, offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 16000 } }, required: ["topic"], additionalProperties: false };
const descriptors: FabricActionDescriptor[] = [
  { name: "info", description: "Bounded health, lifecycle and workspace status through Code Mode", risk: "read", effect: { kind: "none" }, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "help", description: "Read only immutable bundled API instructions; zero-based character paging", risk: "read", effect: { kind: "none" }, inputSchema: HELP_SCHEMA },
  // Selecting a client-verified root is an explicit bootstrap operation, not a
  // filesystem write. Manual attach retains its existing exact elicitation.
  { name: "workspace", description: "Inspect roots or prepare a separate, deferred workspace transition", risk: "read", effect: { kind: "none" }, inputSchema: kiroWorkspaceToolInputSchema },
];

export class FabricBootstrapProvider implements FabricProvider {
  readonly name = "fabric";
  readonly description = "Checked bootstrap and immutable bundled help";
  constructor(readonly maxResultChars = 20000) {}
  discoveryRevision(): string { return "1"; }
  async list(): Promise<FabricActionDescriptor[]> { return descriptors.map((entry) => structuredClone(entry)); }
  async describe(name: string): Promise<FabricActionDescriptor | undefined> { return (await this.list()).find((entry) => entry.name === name); }
  async invoke(name: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if (name === "help") {
      if (!Value.Check(HELP_SCHEMA, args)) throw new Error("Invalid fabric.help topic/arguments");
      if (!Number.isSafeInteger(this.maxResultChars) || this.maxResultChars < 262) throw new Error("Nested result budget too small for bounded help");
      const source = DOCUMENTS[String(args.topic)]!;
      const offset = typeof args.offset === "number" ? args.offset : 0;
      // Measure the actual envelope. At smaller configured budgets a worst-case
      // /6 allowance splits ordinary help long before the actual envelope fills.
      const page = (size: number) => {
        const text = source.slice(offset, offset + size);
        const truncated = offset + text.length < source.length;
        return { topic: args.topic, text, truncated, ...(truncated ? { nextOffset: offset + text.length } : {}) };
      };
      // Serve the requested topic in one page when it fits the existing limits.
      const high = Math.min(typeof args.limit === "number" ? args.limit : 16000, Math.max(0, source.length - offset));
      const full = page(high);
      if (JSON.stringify(full).length <= this.maxResultChars) return full;
      const low = largestFittingInteger(0, high, size => JSON.stringify(page(size)).length <= this.maxResultChars);
      if (low === 0) throw new Error("Nested result budget too small for help progress");
      return page(low);
    }
    if (!context.bootstrap) throw new Error("Kiro bootstrap context is unavailable in this library execution");
    if (name === "workspace") {
      if (!Value.Check(kiroPowerWorkspaceRequestSchema, args)) throw new Error("Invalid fabric.workspace action/arguments");
      return this.#boundedWorkspace(await context.bootstrap.workspace(args, context.signal, context.chargeApproval), args);
    }
    if (name === "info") return this.#bounded(await context.bootstrap.info());
    throw new Error(`Unknown bootstrap action: ${name}`);
  }
  #boundedWorkspace(value: unknown, args: Record<string, unknown>): unknown {
    const fits = (candidate: unknown): boolean => JSON.stringify(candidate).length <= this.maxResultChars;
    if (fits(value) && args.offset === undefined && args.limit === undefined) return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace response");
    const item = value as Record<string, unknown>;
    const summary = Object.fromEntries(["status", "rootId", "source", "requiresSelection", "context", "verification", "action", "committed", "nextExecutionRequired"]
      .filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    if (item.recovery !== undefined) summary.recovery = { instruction: "Start a new session from a project directory with the installed kiro-fabric launcher." };
    if (args.action !== "list" || !Array.isArray(item.roots)) {
      const response = { ...summary, truncated: true };
      if (!fits(response)) throw new Error("Nested result budget too small for workspace status");
      return response;
    }
    const roots = item.roots;
    const offset = typeof args.offset === "number" ? args.offset : 0;
    const high = Math.min(typeof args.limit === "number" ? args.limit : roots.length, Math.max(0, roots.length - offset));
    const detailsTruncated = item.name !== undefined || item.recovery !== undefined;
    const page = (entries: unknown[]) => {
      const nextOffset = offset + entries.length;
      const truncated = nextOffset < roots.length;
      return { ...summary, roots: entries, totalRoots: roots.length, offset, truncated,
        ...(detailsTruncated ? { detailsTruncated: true } : {}),
        ...(truncated ? { nextOffset, continuation: { ref: "fabric.workspace", args: { action: "list", offset: nextOffset,
          ...(args.limit === undefined ? {} : { limit: args.limit }) } } } : {}) };
    };
    const full = page(roots.slice(offset, offset + high));
    if (fits(full)) return full;
    const count = largestFittingInteger(0, high, size => fits(page(roots.slice(offset, offset + size))));
    if (count > 0) return page(roots.slice(offset, offset + count));
    const first = roots[offset] as { rootId: string; name: string } | undefined;
    if (first) {
      const compact = (size: number) => page([{ rootId: first.rootId, name: first.name.slice(0, size), nameTruncated: true }]);
      if (fits(compact(0))) return compact(largestFittingInteger(0, first.name.length, size => fits(compact(size))));
    }
    throw new Error("Nested result budget too small for workspace list progress");
  }
  #bounded(value: unknown): unknown {
    if (JSON.stringify(value).length <= this.maxResultChars) return value;
    // Preserve JSON-object shape and explicitly disclose omitted details;
    // generic bridge truncation must never replace a documented typed result.
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const summary = { ...Object.fromEntries(["product", "executor", "workspace", "lifecycle", "runProvenance"]
        .filter(key => item[key] !== undefined).map(key => [key, item[key]])), truncated: true };
      if (JSON.stringify(summary).length <= this.maxResultChars) return summary;
    }
    return { truncated: true, message: "Bootstrap detail exceeds the configured nested-result budget; increase that budget for full health/root details" };
  }
}
