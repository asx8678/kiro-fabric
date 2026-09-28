import { createHash } from "node:crypto";
import path from "node:path";
import type { FabricApprovalConfig } from "../../config.js";
import {
  FABRIC_APPROVAL_TIMEOUT_MS,
  type FabricApprovalPlan,
  type FabricExecutionApprover,
} from "../../execution-service.js";
import type { ResolvedFabricAction } from "../../protocol.js";
import { fabricJsonText } from "../../runtime/json-budget.js";

export interface KiroPowerElicitationAdapter {
  supported(): boolean;
  request(options: {
    title: string;
    message: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<{ action: "accept" | "decline" | "cancel"; approved?: boolean }>;
}

/** Static diagnostics, never raw client errors. Only a matching observed error
 * establishes a missing handler; capabilities alone do not prove UI readiness. */
const APPROVAL_FAILURE_GUIDANCE: Record<KiroApprovalFailureReason, string> = {
  unsupported: "This client has not advertised MCP form elicitation. Use a compatible client; do not weaken approval policy.",
  missing_handler: "This client reported no handler for _kiro/mcp/elicitation. Use a client with working approval forms; do not weaken approval policy.",
  request_failed: "The approval request failed; no explicit approval was obtained.",
  declined: "The client returned a decline decision.",
  cancelled: "The approval wait was cancelled.",
  not_approved: "The client returned no explicit approval.",
  review_too_large: "The exact review material exceeded the approval form bound. Narrow the action before requesting approval.",
};

const SECRET_KEY = /(?:apikey|authorization|authtoken|bearer|clientkey|clientsecret|cookie|credential|idtoken|passphrase|password|privatekey|refreshtoken|secret|session|token)/iu;
const SECRET_VALUE = /^(?:(?:basic|bearer)\s+|gh[pousr]_|github_pat_|sk-[a-z0-9_-]{12,}|akia[0-9a-z]{12,}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.|-----begin\s)|(?:^|[?&])(?:api[_-]?key|password|secret|token)=/iu;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//iu;
const isSecretKey = (key: string): boolean => SECRET_KEY.test(key.replace(/[_\-\s]/gu, ""));
const bounded = (value: string, maximum = 1_500): string => value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum);
const APPROVAL_MESSAGE_CHARS = 1_500;

const fabricApprovalIdentity = (
  action: ResolvedFabricAction,
  args: Record<string, unknown>,
) => {
  const canonical = fabricJsonText({ schemaVersion: 1, ref: action.ref, risk: action.risk, args });
  return {
    digest: createHash("sha256").update("kiro-fabric-approval-v1\0").update(canonical).digest("hex"),
    chars: canonical.length,
  };
};

export type KiroApprovalFailureReason = "unsupported" | "missing_handler" | "request_failed" | "declined" | "cancelled" | "not_approved" | "review_too_large";
export type KiroApprovalResult = { approved: true } | { approved: false; reason: KiroApprovalFailureReason };

/** Classify only the matching client error; never retain its text, data or cause. */
export const kiroElicitationFailureReason = (error: unknown): KiroApprovalFailureReason => {
  try {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return /(?:^|\n|: )No handler registered for method: _kiro\/mcp\/elicitation\s*$/u.test(message)
      ? "missing_handler" : "request_failed";
  } catch { return "request_failed"; }
};

class KiroApprovalError extends Error {
  constructor(ref: string, readonly reason: KiroApprovalFailureReason) {
    super(`${ref} approval was denied or unavailable (${reason}): ${APPROVAL_FAILURE_GUIDANCE[reason]} This action was not dispatched.`);
    this.name = "KiroApprovalError";
  }
}

export class KiroPowerApprover {
  constructor(
    readonly adapter: KiroPowerElicitationAdapter,
    readonly timeoutMs = FABRIC_APPROVAL_TIMEOUT_MS,
  ) {}
  async approveOnce(request: { risk: string; provider: string; action: string; summary: string; reviewable?: boolean; signal?: AbortSignal }): Promise<boolean> {
    request.signal?.throwIfAborted();
    const result = await this.approveOnceResult(request);
    request.signal?.throwIfAborted();
    return result.approved;
  }
  async approveOnceResult(request: { risk: string; provider: string; action: string; summary: string; reviewable?: boolean; signal?: AbortSignal }): Promise<KiroApprovalResult> {
    try {
      if (request.signal?.aborted) return { approved: false, reason: "cancelled" };
      if (!this.adapter.supported()) return { approved: false, reason: "unsupported" };
      const header = `Risk: ${bounded(request.risk, 64)}\nAction: ${bounded(`${request.provider}.${request.action}`, 256)}\n`;
      const review = request.reviewable
        ? request.summary.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
        : bounded(request.summary, Math.max(0, APPROVAL_MESSAGE_CHARS - header.length));
      // Exact local material must never acquire an invisible authorized suffix.
      if (request.reviewable && header.length + review.length > 12_000) return { approved: false, reason: "review_too_large" };
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: `${header}${review}`,
        ...(request.signal ? { signal: request.signal } : {}),
        timeoutMs: this.timeoutMs,
      });
      if (request.signal?.aborted) return { approved: false, reason: "cancelled" };
      if (result?.action === "accept" && result.approved === true) return { approved: true };
      return { approved: false, reason: result?.action === "decline" ? "declined" : result?.action === "cancel" ? "cancelled" : "not_approved" };
    } catch (error) {
      return { approved: false, reason: request.signal?.aborted ? "cancelled" : kiroElicitationFailureReason(error) };
    }
  }
}

const summarize = (args: Record<string, unknown>, cwd: string): string => {
  let nodes = 0;
  const redact = (value: unknown, key: string, depth: number): unknown => {
    if (++nodes > 128 || depth > 5) return "<bounded>";
    if (isSecretKey(key)) return "<redacted>";
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) return "<redacted>";
      if (path.isAbsolute(value)) {
        const relative = path.relative(cwd, value);
        return relative === "" ? "." : relative.startsWith("..") || path.isAbsolute(relative) ? "<outside-workspace>" : relative;
      }
      if (URL_VALUE.test(value) || /(?:url|uri|endpoint)/iu.test(key)) {
        try {
          const url = new URL(value);
          url.username = "";
          url.password = "";
          if (url.pathname !== "/") url.pathname = "/<redacted>";
          if (url.search) url.search = "?<redacted>";
          url.hash = "";
          return bounded(url.toString(), 500);
        } catch { return "<redacted-url>"; }
      }
      return bounded(value, 500);
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 24).map((entry) => redact(entry, key, depth + 1));
    if (typeof value === "object") {
      const safe = Object.create(null) as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
        safe[nestedKey] = redact(nestedValue, nestedKey, depth + 1);
      }
      return safe;
    }
    return `<${typeof value}>`;
  };
  return bounded(JSON.stringify(redact(args, "arguments", 0)));
};

export class KiroPowerFabricApprover implements FabricExecutionApprover {
  constructor(
    readonly config: FabricApprovalConfig,
    readonly elicitation: KiroPowerApprover,
    readonly cwd: string,
  ) {}
  async approve(
    action: ResolvedFabricAction,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const plan = this.prepareApproval(action, args, signal);
    if (plan.decision === "deny") throw new Error(plan.reason);
    if (plan.decision === "ask") await plan.prompt();
  }

  prepareApproval(
    action: ResolvedFabricAction,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): FabricApprovalPlan {
    signal?.throwIfAborted();
    const mode = this.config[action.risk];
    if (mode === "deny") return { decision: "deny", reason: `${action.ref} is denied by Fabric policy` };
    if (mode !== "allow" && mode !== "ask") return { decision: "deny", reason: `${action.ref} has invalid Fabric approval policy` };
    if (mode === "allow") return { decision: "allow" };
    const identity = fabricApprovalIdentity(action, args);
    const localReview = action.provider === "local" && (action.risk === "write" || action.risk === "execute")
      ? typeof args.review === "string" ? args.review : (() => { throw new Error("Local effect lacks canonical review material"); })()
      : undefined;
    const exactReview = localReview;
    // Capture review/identity now, without prompting or re-reading policy later.
    const ref = action.ref;
    const request = {
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: `Canonical request: sha256:${identity.digest} (${identity.chars} chars)\n${exactReview ?? `Preview: ${summarize(args, this.cwd)}`}`,
      ...(exactReview === undefined ? {} : { reviewable: true }),
      ...(signal ? { signal } : {}),
    };
    return {
      decision: "ask",
      prompt: async () => {
        const result = await this.elicitation.approveOnceResult(request);
        if (!result.approved) throw new KiroApprovalError(ref, result.reason);
      },
    };
  }
}
