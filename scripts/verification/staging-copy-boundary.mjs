// I07-only deterministic copy boundary. Test-controlled module-loader
// instrumentation around the REAL pinned capture/stream path: it never weakens
// the production validator, adds no CLI bypass and never mutates production
// modules. The patched captureRegular delegates to the real implementation.
//
// Guarantees used by I07:
//   * rejection is observed synchronously (`settled` handler attached before any await),
//   * the barrier is released and the in-flight staging promise is joined on every exit,
//   * the boundary is reached by control flow, never by polling or wall-clock sleeps,
//   * each boundary instance owns a unique token; only the matching patched
//     captureRegular can pause, and the armed controller is removed afterwards.
//
// Disposable-worker restriction: `register()` installs a process-wide ESM hook
// with no supported unregister API. This module is therefore only ever loaded by
// the disposable verification worker; it must not be used in a long-lived
// process. The hook itself is scoped by exact importer/contract URL (see
// staging-copy-boundary-loader.mjs) so it cannot intercept canonical or
// unrelated modules even while registered.
//
// A mutation callback that never settles is bounded by `mutationTimeoutMs`. The
// boundary is released and the real staging promise is joined, then the timeout
// is reported. Node cannot cancel an arbitrary pending callback, so a timed-out
// callback may still act later; this helper makes no stronger cancellation claim.

import { register } from "node:module";

export const STAGING_COPY_BOUNDARY_KEY = "__KIRO_FABRIC_STAGING_COPY_BOUNDARY__";
export const STAGING_BOUNDARY_TAG = "kiro-fabric-staging-boundary";
export const DEFAULT_MUTATION_BUDGET_MS = 30000;

let loaderRegistered = false;
let invocationCounter = 0;

/** Register the private loader hook once per process. Node offers no unregister. */
export function registerStagingCopyBoundaryLoader() {
  if (loaderRegistered) return;
  register(new URL("./staging-copy-boundary-loader.mjs", import.meta.url).href);
  loaderRegistered = true;
}

/**
 * @typedef {object} CopyBoundaryController
 * @property {string} member Relative member whose capture pauses.
 * @property {string} instance Unique boundary instance that owns this pause.
 * @property {(file:string)=>boolean} shouldPause
 * @property {(file:string)=>Promise<void>} pause
 * @property {()=>void} release
 * @property {Promise<string>} reached
 */

/**
 * Arm a per-invocation copy boundary. The patched captureRegular resolves
 * `reached` and waits before capturing `member` until `release()` is called.
 * Only a wrapper carrying the matching `instance` token observes this boundary.
 *
 * @param {{member:string, instance:string}} options
 * @returns {CopyBoundaryController}
 */
export function armCopyBoundary({ member, instance }) {
  if (typeof member !== "string" || member === "") throw new Error("armCopyBoundary: member required");
  if (typeof instance !== "string" || instance === "") throw new Error("armCopyBoundary: instance required");
  /** @type {(value:string)=>void} */
  let reach;
  /** @type {()=>void} */
  let release;
  const reached = new Promise(resolve => { reach = resolve; });
  const released = new Promise(resolve => { release = () => resolve(undefined); });
  const normalized = member.startsWith("/") ? member : "/" + member;
  const controller = {
    member,
    instance,
    shouldPause: file => typeof file === "string" && file.endsWith(normalized),
    pause: async file => { reach(file); await released; },
    release: () => release(),
    reached,
  };
  globalThis[STAGING_COPY_BOUNDARY_KEY] = controller;
  return controller;
}

/**
 * Remove this invocation's armed boundary. Deletes the own global property
 * rather than parking a null; a controller armed by a different invocation is
 * left untouched.
 * @param {CopyBoundaryController} [controller]
 */
export function disarmCopyBoundary(controller) {
  if (controller === undefined || globalThis[STAGING_COPY_BOUNDARY_KEY] === controller) {
    delete globalThis[STAGING_COPY_BOUNDARY_KEY];
  }
}

/**
 * Import a loader-patched source-bundle-stage instance. Every call uses a fresh
 * unique token, so the stage module and its patched contract module are cache
 * misses owned by exactly this invocation. The canonical instance (and every
 * production or unrelated caller) is untouched.
 *
 * @returns {Promise<{stageSourceBundle:(source:string, output:string)=>Promise<any>, instance:string}>}
 */
export async function importBoundaryStageSourceBundle() {
  registerStagingCopyBoundaryLoader();
  invocationCounter += 1;
  const instance = "b" + invocationCounter.toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  const url = new URL("../source-bundle-stage.mjs", import.meta.url);
  url.searchParams.set(STAGING_BOUNDARY_TAG, instance);
  const module = await import(url.href);
  return { stageSourceBundle: module.stageSourceBundle, instance };
}

/**
 * @typedef {object} ControlledDriftResult
 * @property {"fulfilled"|"rejected"} status
 * @property {any} [value]
 * @property {any} [error]
 * @property {boolean} boundaryReached
 */

/**
 * Stage a bundle while paused at a deterministic copy boundary, run `mutate`
 * while the real copy is still in flight, then release and join on every exit.
 * Rejection is observed immediately, so an early failure can never become an
 * unhandled rejection. A mutation that never settles is bounded by
 * `mutationTimeoutMs`: the boundary is released, the real staging promise is
 * joined, and a timeout error is raised. The pending callback is not cancelled
 * and may still act later.
 *
 * @param {{source:string, output:string, member:string, mutate:()=>void|Promise<void>, mutationTimeoutMs?:number}} options
 * @returns {Promise<ControlledDriftResult>}
 */
export async function stageWithControlledDrift({ source, output, member, mutate, mutationTimeoutMs = DEFAULT_MUTATION_BUDGET_MS }) {
  if (typeof mutate !== "function") throw new Error("stageWithControlledDrift: mutate required");
  if (!Number.isSafeInteger(mutationTimeoutMs) || mutationTimeoutMs < 1) throw new Error("stageWithControlledDrift: invalid mutation budget");
  const { stageSourceBundle, instance } = await importBoundaryStageSourceBundle();
  const controller = armCopyBoundary({ member, instance });
  /** @type {Promise<ControlledDriftResult>|null} */
  let settled = null;
  try {
    const pending = stageSourceBundle(source, output);
    // Immediate observation: attach both handlers before awaiting anything.
    settled = pending.then(
      value => ({ status: "fulfilled", value, boundaryReached: false }),
      error => ({ status: "rejected", error, boundaryReached: false }),
    );
    const first = await Promise.race([controller.reached.then(() => "reached"), settled.then(() => "settled")]);
    const reached = first === "reached";
    /** @type {Error|null} */
    let mutationError = null;
    if (reached) {
      const mutation = Promise.resolve().then(mutate);
      // A timed-out callback is not cancelled; swallow any later rejection so it
      // cannot escape as an unhandled rejection under strict mode.
      mutation.catch(() => {});
      let timer;
      try {
        await Promise.race([
          mutation,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              /** @type {Error & {code?:string}} */
              const error = new Error("stageWithControlledDrift: mutation budget exceeded after " + mutationTimeoutMs + "ms");
              error.code = "MUTATION_BUDGET_EXCEEDED";
              reject(error);
            }, mutationTimeoutMs);
          }),
        ]);
      } catch (error) {
        mutationError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timer);
        controller.release();
      }
    }
    const outcome = await settled;
    if (mutationError) throw mutationError;
    return { ...outcome, boundaryReached: reached };
  } finally {
    controller.release();
    disarmCopyBoundary(controller);
    if (settled !== null) await settled;
  }
}
