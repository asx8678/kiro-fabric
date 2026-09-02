import { createHash } from "node:crypto";
import path from "node:path";
import type { FabricApprovalConfig } from "../../config.js";
import {
  FABRIC_APPROVAL_TIMEOUT_MS,
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

const SECRET_KEY = /(?:apikey|authorization|authtoken|bearer|clientkey|clientsecret|cookie|credential|idtoken|passphrase|password|privatekey|refreshtoken|secret|session|token)/iu;
const SECRET_VALUE = /^(?:(?:basic|bearer)\s+|gh[pousr]_|github_pat_|sk-[a-z0-9_-]{12,}|akia[0-9a-z]{12,}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.|-----begin\s)|(?:^|[?&])(?:api[_-]?key|password|secret|token)=/iu;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//iu;
const isSecretKey = (key: string): boolean => SECRET_KEY.test(key.replace(/[_\-\s]/gu, ""));
const bounded = (value: string, maximum = 1_500): string => value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum);
const APPROVAL_MESSAGE_CHARS = 1_500;

const fabricApprovalIdentity = (action: ResolvedFabricAction, args: Record<string, unknown>) => {
  const canonical = fabricJsonText({ schemaVersion: 1, ref: action.ref, risk: action.risk, args });
  return {
    digest: createHash("sha256").update("kiro-fabric-approval-v1\0").update(canonical).digest("hex"),
    chars: canonical.length,
  };
};

export class KiroPowerApprover {
  constructor(
    readonly adapter: KiroPowerElicitationAdapter,
    readonly timeoutMs = FABRIC_APPROVAL_TIMEOUT_MS,
  ) {}
  async approveOnce(request: { risk: string; provider: string; action: string; summary: string; signal?: AbortSignal }): Promise<boolean> {
    request.signal?.throwIfAborted();
    if (!this.adapter.supported()) return false;
    try {
      const header = `Risk: ${bounded(request.risk, 64)}\nAction: ${bounded(`${request.provider}.${request.action}`, 256)}\n`;
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: `${header}${bounded(request.summary, Math.max(0, APPROVAL_MESSAGE_CHARS - header.length))}`,
        ...(request.signal ? { signal: request.signal } : {}),
        timeoutMs: this.timeoutMs,
      });
      request.signal?.throwIfAborted();
      return result.action === "accept" && result.approved === true;
    } catch {
      if (request.signal?.aborted) request.signal.throwIfAborted();
      return false;
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
  constructor(readonly config: FabricApprovalConfig, readonly elicitation: KiroPowerApprover, readonly cwd: string) {}
  async approve(action: ResolvedFabricAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const mode = this.config[action.risk];
    if (mode === "allow") return;
    if (mode === "deny") throw new Error(`${action.ref} is denied by Fabric policy`);
    const identity = fabricApprovalIdentity(action, args);
    const approved = await this.elicitation.approveOnce({
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: `Canonical request: sha256:${identity.digest} (${identity.chars} chars)\nPreview: ${summarize(args, this.cwd)}`,
      ...(signal ? { signal } : {}),
    });
    if (!approved) throw new Error(`${action.ref} approval was denied or unavailable`);
  }
}
