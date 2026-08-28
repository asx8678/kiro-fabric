import type { FabricAgentTransport } from "../config.js";
import type { AgentTransportAdapter } from "./types.js";
import { HerdrTransport } from "./transports/herdr-transport.js";
import { LocaltermTransport } from "./transports/localterm-transport.js";
import { ProcessTransport } from "./transports/process-transport.js";
import { ScreenTransport } from "./transports/screen-transport.js";
import { TmuxTransport } from "./transports/tmux-transport.js";

/**
 * Auto-selection priority used when a caller requests `"auto"`. This is the
 * authoritative ordering (kept identical to the previous inline behaviour).
 */
const AUTO_PRIORITY: readonly FabricAgentTransport[] = [
  "herdr",
  "localterm",
  "tmux",
  "screen",
  "process",
];

/**
 * Owns the set of available agent transport adapters and resolves a requested
 * transport (explicit or "auto") to a *ready* adapter. Extracted from
 * AgentManager so the manager no longer builds or selects transports directly;
 * the selection contract, priority, and error strings are unchanged.
 */
export class ExecutorRegistry {
  readonly #transports: Map<FabricAgentTransport, AgentTransportAdapter>;

  constructor(adapters?: readonly AgentTransportAdapter[]) {
    const registry = adapters ?? [
      new ProcessTransport(),
      new TmuxTransport(),
      new ScreenTransport(),
      new LocaltermTransport(),
      new HerdrTransport(),
    ];
    this.#transports = new Map(registry.map((adapter) => [adapter.kind, adapter]));
  }

  get availableKinds(): readonly FabricAgentTransport[] {
    return [...this.#transports.keys()];
  }

  /** Adapter registered for a kind, without availability probing. */
  adapterFor(kind: FabricAgentTransport): AgentTransportAdapter | undefined {
    return this.#transports.get(kind);
  }

  /**
   * Resolve a transport request to a ready adapter, probing `available()`.
   * Throws the exact same errors the manager previously produced.
   */
  async resolve(requested: FabricAgentTransport): Promise<AgentTransportAdapter> {
    if (requested !== "auto") {
      const adapter = this.#transports.get(requested);
      if (!adapter || !(await adapter.available())) {
        throw new Error(`Fabric agent transport is unavailable: ${requested}`);
      }
      return adapter;
    }
    for (const kind of AUTO_PRIORITY) {
      const adapter = this.#transports.get(kind);
      if (adapter && (await adapter.available())) return adapter;
    }
    throw new Error("No Fabric agent transport is available");
  }
}