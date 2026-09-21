import { describe, expect, it } from 'vitest';
import { identityPreimages, diagnoseReferencePair, assertNonemptyReference } from '../../scripts/fovea-reference-diagnostics.mjs';
function sample(reverse = false) {
  const nodes = [{ id: 'a', kind: 'function', file: 'a.ts', line: 1, lang: 'TypeScript', sig: 'a()' }, { id: 'b', kind: 'function', file: 'a.ts', line: 2, lang: 'TypeScript', sig: 'b()' }];
  const state = { generation: '', version: '', graph: { nodes: reverse ? [...nodes].reverse() : nodes, edges: [] }, facts: { 'a.ts': { sha1: 'source' } }, files: ['a.ts'], rulesSha: 'rules', extraction: {}, discovery: {} };
  const identity = identityPreimages(state); state.generation = identity.generation; state.version = identity.version;
  const outputs = { focus: { details: { nodes: ['a'], generation: state.generation, version: state.version } } };
  return { state, outputs };
}
describe('strict reference identity diagnostics', () => {
  it('reconstructs the identity without changing it', () => { const v = sample(); expect(identityPreimages(v.state).verified).toBe(true); expect(() => assertNonemptyReference(v)).not.toThrow(); });
  it('proves order-only hash divergence without waiving those fields', () => { const r = diagnoseReferencePair(sample(), sample(true)); expect(r.qualified).toBe(false); expect(r.graphNodeMultisetEqual).toBe(true); expect(r.graphEdgeMultisetEqual).toBe(true); expect(r.differences).toEqual(['$.focus.details.generation', '$.focus.details.version']); expect(r.orderedNodeDifferences.length).toBeGreaterThan(0); });
  it('preserves actual content differences', () => { const a = sample(); a.state.graph.nodes[0]!.sig = 'different'; const r = diagnoseReferencePair(sample(), a); expect(r.graphNodeMultisetEqual).toBe(false); expect(r.identities.native.verified).toBe(false); expect(r.qualified).toBe(false); });
  it('does not alter numeric comparison or output order', () => { const a = sample(); a.outputs.focus.details.nodes.reverse(); a.outputs.focus.details.nodes.push('b'); expect(diagnoseReferencePair(sample(), a).differences).toContain('$.focus.details.nodes.1'); });
  it('refuses empty discovery and forged identities', () => { const a = sample(); a.state.graph.nodes = []; expect(() => assertNonemptyReference(a)).toThrow('Empty discovery'); const b = sample(); b.state.version = 'forged'; expect(() => assertNonemptyReference(b)).toThrow('invalid graph identity'); });
  it('is read-only and exact equal input remains equal', () => { const v = sample(); const before = JSON.stringify(v); expect(diagnoseReferencePair(v, v).qualified).toBe(true); expect(JSON.stringify(v)).toBe(before); });
});
