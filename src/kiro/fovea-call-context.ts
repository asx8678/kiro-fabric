import path from "node:path";
import type { FoveaBoundClient } from "../fovea/host.js";
import type { FoveaObservation, FoveaObserver } from "../fovea/observations.js";
import type { FabricInvocationContext } from "../protocol.js";
import { collectFoveaContext, type FoveaContextProjection } from "./fovea-context.js";
import type { KiroProjectionResult } from "./projection.js";

const LOCAL_SOURCE_ACTIONS = new Set(["local.read", "local.readMany", "local.write", "local.edit"]);
const NAVIGATION_ACTIONS = new Set(["repo.focus", "repo.sketch", "repo.dwell", "repo.impact", "repo.augment", "repo.anchors", "repo.rules", "repo.sync"]);
const MAX_FILES = 16;

/** Invocation-local attention only. Successful current navigation suppresses
 * redundant hints, not diagnostics or mutations after/in parallel with it.
 * Failures and uncertain effects remain fail-closed. */
export class FoveaCallObservation implements FoveaObserver {
  readonly #paths = new Map<string, boolean>();
  readonly #navigationStarts = new Map<string, number>();
  #suppressed = false;
  #navigated = false;
  #revision = 0;
  #sampled = false;
  constructor(readonly root: string, private readonly downstream?: FoveaObserver) {}
  observe(event: FoveaObservation): void {
    if (event.phase === "failed" || event.uncertain) this.#suppressed = true;
    if (!this.#suppressed && NAVIGATION_ACTIONS.has(event.ref)) {
      if (event.phase === "prepared") {
        if (this.#navigationStarts.size >= 128) this.#suppressed = true;
        else this.#navigationStarts.set(event.operationId, this.#revision);
      }
      if (event.phase === "settled") {
        if (this.#navigationStarts.get(event.operationId) === this.#revision) {
          this.#navigated = true; this.#paths.clear(); this.#sampled = false;
        }
        this.#navigationStarts.delete(event.operationId);
      }
    }
    if (!this.#suppressed && LOCAL_SOURCE_ACTIONS.has(event.ref) && ["access", "committed"].includes(event.phase)) {
      const mutation = event.phase === "committed";
      if (mutation) { this.#revision++; this.#navigated = false; }
      if (!this.#navigated) for (const file of event.paths ?? []) {
        const relative = path.isAbsolute(file) ? path.relative(this.root, file) : file;
        if (!relative || relative.includes("\0") || relative.length > 4096 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.normalize(relative) !== relative) {
          this.#suppressed = true; break;
        }
        const name = relative.split(path.sep).join("/");
        if (this.#paths.has(name)) { if (mutation) this.#paths.set(name, true); continue; }
        if (this.#paths.size >= MAX_FILES) {
          this.#sampled = true;
          if (!mutation) continue;
          // Prefer actual mutations over read-only seeds in the bounded sample.
          const victim = [...this.#paths].find(([, changed]) => !changed)?.[0] ?? this.#paths.keys().next().value!;
          this.#paths.delete(victim);
        }
        this.#paths.set(name, mutation);
      }
    }
    this.downstream?.observe(event);
  }
  gap(): void { this.#suppressed = true; this.downstream?.gap(); }
  files(): string[] { return this.#suppressed ? [] : [...this.#paths.keys()]; }
  sampled(): boolean { return this.#sampled; }
}

/** Same-call visible MCP context, NOT native prompt/stop delivery. */
export async function collectFoveaCallContext(client: FoveaBoundClient, observations: FoveaCallObservation,
  original: KiroProjectionResult, context: FabricInvocationContext, maxOutputChars: number): Promise<FoveaContextProjection> {
  const files = observations.files();
  if (!files.length || original.isError || original.executionStatus !== "succeeded" || !client.collectCallContext) return { projection: original };
  return collectFoveaContext({
    ...client,
    observer: { observe() {}, gap() {} },
    collectContext: (ctx, max) => client.collectCallContext!(files, ctx, max, observations.sampled()),
  }, original, context, maxOutputChars);
}
