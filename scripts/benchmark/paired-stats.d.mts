/** Type declarations for the pure paired-sample benchmark-statistics module. */

export type PairedSample = {
  singleMs: number;
  batchMs: number;
};

export const mulberry32: (seed: number) => () => number;

export const pairedSpeedupLowerBound: (
  samples: PairedSample[],
  options?: { seed?: number; iterations?: number; confidence?: number },
) => number;

export const medianSpeedup: (samples: PairedSample[]) => number;

export const meshBatchGate: (
  samples: PairedSample[],
  options?: { threshold?: number; seed?: number; iterations?: number },
) => boolean;