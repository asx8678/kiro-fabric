/**
 * Deterministic paired-sample statistics for the mesh-publish benchmark gate.
 * Pure and seeded so results are reproducible; deliberately minimal (shared
 * PRNG + paired bootstrap + practical threshold) so it can be unit-tested
 * without a filesystem or real workload. This is a `.mjs` module and must stay
 * valid plain JavaScript.
 */

/** Deterministic 32-bit PRNG (mulberry32). Returns () => float in [0,1). */
export const mulberry32 = (seed /** number */) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * @typedef {Object} PairedSample
 * @property {number} singleMs  scalar publish() total for the sample
 * @property {number} batchMs   publishBatch() total for the sample
 */

const ratio = (s /** PairedSample */) => (s.batchMs > 0 ? s.singleMs / s.batchMs : 1);

/**
 * One-sided lower confidence bound on the speedup (singleMs / batchMs) via a
 * seeded paired bootstrap.
 */
export const pairedSpeedupLowerBound = (
  samples /** PairedSample[] */,
  options /** {seed?,iterations?,confidence?} */ = {},
) => {
  const iterations = options.iterations ?? 20_000;
  const quantile = options.confidence ?? 0.99;
  if (samples.length === 0) return 0;
  const ratios = samples.map(ratio);
  const rnd = mulberry32(options.seed ?? 1);
  const resampled = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < ratios.length; j++) sum += ratios[Math.floor(rnd() * ratios.length)];
    resampled.push(sum / ratios.length);
  }
  resampled.sort((a, b) => a - b);
  // One-sided lower confidence bound: use the (1 - confidence) percentile tail.
  const index = Math.max(0, Math.min(resampled.length - 1, Math.floor((1 - quantile) * resampled.length)));
  return resampled[index];
};

/** Median speedup across the sample set. */
export const medianSpeedup = (samples /** PairedSample[] */) => {
  if (samples.length === 0) return 1;
  const values = samples.map(ratio).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};

/**
 * Practical gate: passes only when the paired bootstrap lower bound clears the
 * threshold and the sample is large enough to be meaningful.
 */
export const meshBatchGate = (samples /** PairedSample[] */, options /* {threshold?,seed?,iterations?} */ = {}) => {
  if (samples.length < 2) return false;
  const threshold = options.threshold ?? 1.25;
  return pairedSpeedupLowerBound(samples, options) >= threshold;
};