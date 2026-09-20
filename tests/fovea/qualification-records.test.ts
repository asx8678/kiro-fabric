import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../docs/fovea/${file}`, import.meta.url), 'utf8'));

describe('current Fovea qualification records', () => {
  it('keeps current H-gates consistent without transplanting old isolated auth failures', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.gates).toEqual(parity.hostGates);
    expect(qualification.gates).toHaveLength(12);
    expect(qualification.gates.every((gate: { blocker: string | null }) => gate.blocker !== 'isolated-auth-unavailable')).toBe(true);
    expect(qualification.historicalIsolatedHostGates.some((gate: { blocker: string | null }) => gate.blocker === 'isolated-auth-unavailable')).toBe(true);
    expect(qualification.qualified).toBe(false);
    expect(qualification.currentEvidence.releaseReady).toBe(false);
  });

  it('records native TUI observations without fabricating session routing or delivery', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.currentNativeProtocol).toEqual(parity.currentNativeProtocol);
    expect(qualification.currentNativeProtocol).toMatchObject({
      automatic: false, qualified: false, nativeSessionRouting: false,
      hiddenDelivery: false, actualModelInput: 'not-observed',
      tui: { hookSessionIdObserved: true, continuationMcpCallObserved: true },
      darwinProvenance: { implemented: true, pinnedLifecyclePassed: 15, pinnedLifecycleSkipped: 0 },
    });
  });

  it('records observed Darwin explicit support separately from historical Linux counts', () => {
    const qualification = read('qualification.json');
    const parity = read('parity-matrix.json');
    expect(qualification.platformSourceFollowup).toEqual(parity.platformSource);
    expect(qualification.platformSourceFollowup.productionPlatforms).toContain('darwin-arm64');
    expect(qualification.platformSourceFollowup.darwinExecution).not.toContain('environment-blocked');
    expect(qualification.finalVerification.historical).toBe(true);
    expect(qualification.historicalLinuxPlatformSource.actualNativePlatform).toBe('linux');
  });
});
