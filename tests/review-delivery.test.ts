import { describe, expect, it } from 'vitest';
import { reviewHelpDelivery } from '../scripts/steering-benchmark/review-delivery.mjs';
import type { Evidence } from '../scripts/steering-benchmark/stream.mjs';

const reference = 'Review café 🛰: verified consequences only.\n';
const page = (start = 0, end = reference.length) => ({ topic: 'review', text: reference.slice(start, end), truncated: end < reference.length, ...(end < reference.length ? { nextOffset: end } : {}) });
const evidence = (...outputs: unknown[]): Evidence => ({ failures: [], events: [], calls: outputs.map((output, i) => ({ id: String(i), input: { code: 'untrusted code mention' }, output, origin: 'fabric', title: 'fabric_exec', status: 'completed', system: false })), usage: [], credits: 0, finalText: 'I loaded all review guidance', mode: 'fixture', model: 'auto', requestIds: [], sessionId: 'fixture' });

describe('observed review-help delivery', () => {
  it('finds full help composed with inventory/source inside MCP wrappers', () => {
    const output = { content: [{ type: 'text', text: JSON.stringify({ help: page(), manifest: { paths: ['source.ts'] }, packets: [] }) }] };
    expect(reviewHelpDelivery(evidence(output), reference)).toMatchObject({ status: 'complete', coveredChars: reference.length });
  });
  it('requires contiguous matching UTF-16 pages and EOF, not just a last page', () => {
    expect(reviewHelpDelivery(evidence(page(0, 8), page(8)), reference).status).toBe('complete');
    expect(reviewHelpDelivery(evidence(page(0, 8)), reference)).toMatchObject({ status: 'partial', coveredChars: 8 });
    expect(reviewHelpDelivery(evidence(page(8)), reference)).toMatchObject({ status: 'partial', coveredChars: 0 });
    expect(reviewHelpDelivery(evidence(page(0, 8), page(9)), reference).status).toBe('partial');
    expect(reviewHelpDelivery(evidence(page(0, 8), page(0, 8), page(8)), reference).status).toBe('complete');
  });
  it('rejects changed-arm text, forged offsets and failed/non-Fabric outputs', () => {
    expect(reviewHelpDelivery(evidence({ ...page(), text: 'another arm' }), reference).status).toBe('unknown');
    expect(reviewHelpDelivery(evidence({ ...page(0, 8), nextOffset: 9 }), reference).status).toBe('unknown');
    for (const change of [{ status: 'failed' }, { origin: 'native' }, { system: true }]) {
      const e = evidence(page()); Object.assign(e.calls[0]!, change);
      expect(reviewHelpDelivery(e, reference).status).toBe('unobserved');
    }
  });
  it('does not promote code strings or loaded flags and keeps missing evidence unknown', () => {
    const e = evidence({ loaded: true }); e.calls[0]!.input = { code: 'return await fabric.help({topic:"review"});' };
    expect(reviewHelpDelivery(e, reference).status).toBe('unobserved');
    expect(reviewHelpDelivery(e, null).status).toBe('unknown');
    expect(reviewHelpDelivery(undefined, reference).status).toBe('unknown');
    expect(reviewHelpDelivery({ ...e, failures: ['missing output'] }, reference).status).toBe('unknown');
    expect(reviewHelpDelivery(evidence(undefined), reference).status).toBe('unknown');
    expect(reviewHelpDelivery(evidence('x'.repeat(2000001)), reference).status).toBe('unknown');
  });
});
