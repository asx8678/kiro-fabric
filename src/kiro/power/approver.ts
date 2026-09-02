import path from "node:path";
import type { FabricApprovalConfig } from "../../config.js";
import {
  FABRIC_APPROVAL_TIMEOUT_MS,
  type FabricExecutionApprover,
} from "../../execution-service.js";
import type { ResolvedFabricAction } from "../../protocol.js";

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

export class KiroPowerApprover {
  constructor(
    readonly adapter: KiroPowerElicitationAdapter,
    readonly timeoutMs = FABRIC_APPROVAL_TIMEOUT_MS,
  ) {}
  async approveOnce(request: { risk: string; provider: string; action: string; summary: string; signal?: AbortSignal }): Promise<boolean> {
    request.signal?.throwIfAborted();
    if (!this.adapter.supported()) return false;
    try {
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: bounded(`Risk: ${request.risk}\nAction: ${request.provider}.${request.action}\n${request.summary}`),
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
  const safe = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    if (isSecretKey(key) || /env/iu.test(key)) safe[key] = "<redacted>";
    else if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) safe[key] = "<redacted>";
      else if (path.isAbsolute(value)) {
        const relative = path.relative(cwd, value);
        safe[key] = relative === "" ? "." : relative.startsWith("..") || path.isAbsolute(relative) ? "<outside-workspace>" : relative;
      } else if (URL_VALUE.test(value) || /(?:url|uri|endpoint)/iu.test(key)) {
        try {
          const url = new URL(value);
          url.username = "";
          url.password = "";
          if (url.pathname !== "/") url.pathname = "/<redacted>";
          if (url.search) url.search = "?<redacted>";
          url.hash = "";
          safe[key] = bounded(url.toString(), 500);
        } catch { safe[key] = "<redacted-url>"; }
      } else safe[key] = bounded(value, 500);
    } else if (value === null || typeof value === "number" || typeof value === "boolean") safe[key] = value;
    else safe[key] = Array.isArray(value) ? `<${value.length} items>` : "<object>";
  }
  return bounded(JSON.stringify(safe));
};

export class KiroPowerFabricApprover implements FabricExecutionApprover {
  constructor(readonly config: FabricApprovalConfig, readonly elicitation: KiroPowerApprover, readonly cwd: string) {}
  async approve(action: ResolvedFabricAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const mode = this.config[action.risk];
    if (mode === "allow") return;
    if (mode === "deny") throw new Error(`${action.ref} is denied by Fabric policy`);
    const approved = await this.elicitation.approveOnce({
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: summarize(args, this.cwd),
      ...(signal ? { signal } : {}),
    });
    if (!approved) throw new Error(`${action.ref} approval was denied or unavailable`);
  }
}
