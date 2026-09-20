import { randomUUID } from "node:crypto";

/** Trusted host facts only. Never include arguments, source text or output. */
export interface FoveaObservation {
  sequence: number;
  operationId: string;
  ref: string;
  phase: "prepared" | "approved" | "access" | "committed" | "failed" | "settled";
  paths?: string[];
  sources?: { path: string; sha256: string }[];
  transitions?: { path: string; beforeSha256: string | null; afterSha256: string | null }[];
  uncertain?: boolean;
}
export interface FoveaObserver {
  observe(event: FoveaObservation): void;
  gap(): void;
}
export type FoveaOperationObservation = Omit<FoveaObservation, "sequence" | "operationId" | "ref">;
export interface FoveaInvocationObservation {
  observe(event: FoveaOperationObservation): void;
}

/** One bounded, ordered prefix per execution. A gap permanently closes it.
 * Observer failures must never alter a provider's publication or result. */
export class FoveaObservationExecution {
  #sequence = 0;
  #gapped = false;
  constructor(private readonly observer: FoveaObserver, private readonly maximum = 4096) {}
  gap(): void {
    if (this.#gapped) return;
    this.#gapped = true;
    try { this.observer.gap(); } catch { /* host refresh remains conservative */ }
  }
  operation(ref: string): FoveaInvocationObservation {
    const operationId = randomUUID();
    return { observe: event => {
      if (this.#gapped) return;
      if (this.#sequence >= this.maximum) { this.gap(); return; }
      try {
        this.observer.observe({ ...structuredClone(event), sequence: ++this.#sequence, operationId, ref });
      } catch { this.gap(); }
    } };
  }
}

/** Also protects direct host/provider use outside FabricExecutionService. */
export function observeFovea(context: { foveaObservation?: FoveaInvocationObservation }, event: FoveaOperationObservation): void {
  try { context.foveaObservation?.observe(event); } catch { /* observation is never execution authority */ }
}
