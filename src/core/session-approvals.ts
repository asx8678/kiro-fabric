// Host-neutral session approval state. Extracted from approval-controller.ts
// so the execution engine and the Kiro adapter can share it without statically
// importing the Pi approval UI (which pulls in pi-tui).

import type { FabricRisk } from "../protocol.js";

export interface FabricAutoApprovalAudit {
  action: string;
  risk: FabricRisk;
  decision: "allow" | "escalate";
  reason: string;
  model?: string;
  error?: string;
  at: number;
}

export class FabricSessionApprovals {
  readonly approvedRisks = new Set<FabricRisk>();
  #tail: Promise<void> = Promise.resolve();

  async serialize<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await request();
    } finally {
      release?.();
    }
  }
}
