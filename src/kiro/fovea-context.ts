import type { FoveaDeliveryClaim } from "../fovea/call-context.js";
import type { FabricInvocationContext } from "../protocol.js";
import type { KiroProjectionResult } from "./projection.js";

const HEADER = "\n\nNavigator advisory (untrusted hints about code affected by this change; verify before relying on them):\n";
export interface FoveaContextProjection { projection: KiroProjectionResult; delivery?: FoveaDeliveryClaim }

/** Called after execution settlement, outside source-effect/approval reservations.
 * Uses only remaining outer budget: mandatory output/recovery always wins. */
export async function collectFoveaContext(collect: (context: FabricInvocationContext, maxChars: number) => Promise<FoveaDeliveryClaim | undefined>, original: KiroProjectionResult, context: FabricInvocationContext, maxOutputChars: number): Promise<FoveaContextProjection> {
  const remaining = Math.min(8192, Math.max(0, maxOutputChars - original.text.length));
  if (remaining < HEADER.length + 256 || context.signal?.aborted || context.deadline?.expired || ["aborted", "timed_out"].includes(original.executionStatus)) return { projection: original };
  let delivery: FoveaDeliveryClaim | undefined;
  try {
    delivery = await collect(context, remaining - HEADER.length);
    if (!delivery) return { projection: original };
    context.signal?.throwIfAborted(); context.deadline?.throwIfExpired();
    const suffix = HEADER + delivery.notices.map(n => n.text).join("\n");
    // Count serialization/escaping, not just raw text or a token estimator.
    if (suffix.length > remaining) { delivery.cancel(); return { projection: original }; }
    const text = original.text + suffix;
    return { projection: { ...original, text, visibleChars: text.length, visibleBytes: Buffer.byteLength(text, "utf8") }, delivery };
  } catch {
    delivery?.cancel();
    // Analysis never changes a committed mutation/error into a failed tool.
    return { projection: original };
  }
}

/** Bounded request-to-transport ledger; a handler return is NOT emission. */
export class FoveaResponseDelivery {
  readonly #pending = new Map<string | number, { claim: FoveaDeliveryClaim; originalText: string; advisoryText: string; dispose(): void }>();
  track(id: string | number, claim: FoveaDeliveryClaim, signal: AbortSignal, originalText: string): boolean {
    if (signal.aborted || this.#pending.size >= 64 || this.#pending.has(id)) { claim.cancel(); return false; }
    const abort = (): void => {
      this.#pending.delete(id);
      signal.removeEventListener("abort", abort);
      claim.cancel();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.#pending.set(id, { claim, originalText, advisoryText: originalText + HEADER + claim.notices.map(n => n.text).join("\n"), dispose: () => signal.removeEventListener("abort", abort) });
    return true;
  }
  async send<T>(message: T, write: (message: T) => Promise<void>): Promise<void> {
    const response = message && typeof message === "object" ? message as Record<string, unknown> : undefined;
    const id = response && (typeof response.id === "string" || typeof response.id === "number") ? response.id : undefined;
    const pending = id !== undefined && response && ("result" in response || "error" in response) ? this.#pending.get(id) : undefined;
    if (pending && id !== undefined) { this.#pending.delete(id); pending.dispose(); }
    const result = response?.result && typeof response.result === "object" ? response.result as Record<string, unknown> : undefined;
    const content = Array.isArray(result?.content) ? result.content : undefined;
    const included = pending !== undefined && content?.[0]?.type === "text" && content[0].text === pending.advisoryText;
    const eligible = included && pending.claim.isCurrent();
    if (!eligible) pending?.claim.cancel();
    let outgoing = message;
    // Revocation/cancellation between projection and transport suppresses only
    // the advisory. Keep the original result/error and recovery metadata intact.
    if (included && !eligible) {
      outgoing = { ...response, result: { ...result, content: content!.map((entry, i) => i === 0 ? { ...entry, text: pending.originalText } : entry) } } as T;
    }
    try {
      await write(outgoing);
      if (eligible) pending.claim.emitted();
    } catch (error) { if (eligible) pending?.claim.uncertain(); throw error; }
  }
  close(): void { for (const pending of this.#pending.values()) { pending.dispose(); pending.claim.cancel(); } this.#pending.clear(); }
}
