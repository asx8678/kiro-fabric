import path from "node:path";
import type { FabricApprovalScope } from "../../core/session-approvals.js";
import type {
  FabricApprovalModeConfig,
  FabricHostApprover,
  FabricResolvedAction,
} from "../host.js";

export interface KiroPowerElicitationAdapter {
  supported(): boolean;
  request(options: {
    title: string;
    message: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<{ action: "accept" | "decline" | "cancel"; approved?: boolean }>;
}

const SECRET = /(token|secret|password|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+/gi;
const bounded = (value: string, maximum = 1_500): string =>
  value.replace(SECRET, "$1=<redacted>").slice(0, maximum);

/** Standards-adapter seam. Every unsupported or malformed outcome is denial. */
export class KiroPowerApprover {
  constructor(readonly adapter: KiroPowerElicitationAdapter, readonly timeoutMs = 30_000) {}

  async approveOnce(request: {
    risk: string;
    provider: string;
    action: string;
    summary: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    if (!this.adapter.supported() || request.signal?.aborted) return false;
    try {
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: bounded(`Risk: ${request.risk}\nAction: ${request.provider}.${request.action}\n${request.summary}`),
        ...(request.signal ? { signal: request.signal } : {}),
        timeoutMs: this.timeoutMs,
      });
      return !request.signal?.aborted && result.action === "accept" && result.approved === true;
    } catch {
      return false;
    }
  }
}

const summarizeArguments = (
  args: Record<string, unknown>,
  cwd: string,
): string => {
  const projectPath = (value: string): string => {
    if (!path.isAbsolute(value)) return value;
    const relative = path.relative(cwd, value);
    return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? relative
      : "<outside-workspace>";
  };
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    if (/(token|secret|password|api[_-]?key|authorization|cookie|env)/i.test(key)) {
      safe[key] = "<redacted>";
    } else if (typeof value === "string") {
      safe[key] = /(?:path|file|cwd|root)/i.test(key)
        ? projectPath(value).slice(0, 500)
        : bounded(value, 500);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = `<${value.length} items>`;
    } else {
      safe[key] = "<object>";
    }
  }
  return bounded(JSON.stringify(safe), 1_500);
};

/** Fabric host adapter: explicit allows pass, denies deny, and ask/auto elicit once. */
export class KiroPowerFabricApprover implements FabricHostApprover {
  constructor(
    readonly config: FabricApprovalModeConfig,
    readonly elicitation: KiroPowerApprover,
    readonly cwd: string,
  ) {}

  async approve(
    action: FabricResolvedAction,
    args: Record<string, unknown>,
    scope: FabricApprovalScope = {},
  ): Promise<void> {
    const mode = this.config[action.risk];
    if (mode === "allow") return;
    if (mode === "deny") throw new Error(`${action.ref} is denied by Fabric policy`);
    const approved = await this.elicitation.approveOnce({
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: `${summarizeArguments(args, this.cwd)}${scope.projectDigest ? "\nWorkspace-bound request" : ""}`,
    });
    if (!approved) throw new Error(`${action.ref} approval was denied or unavailable`);
  }
}
