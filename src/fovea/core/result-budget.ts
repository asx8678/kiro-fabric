// Transport bound, not a change to graph selection or numerical algorithms.
export function boundResultDetails(input: Record<string, unknown>, maxChars = 400_000, maxNodes = 18_000): Record<string, unknown> {
  let chars = 2, nodes = 0, omitted = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > 16 || chars >= maxChars) { omitted++; return undefined; }
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') { chars += 24; return value; }
    if (typeof value === 'string') {
      const size = JSON.stringify(value).length;
      if (chars + size > maxChars) { omitted++; return undefined; }
      chars += size; return value;
    }
    if (Array.isArray(value)) {
      const result: unknown[] = []; chars += 2;
      for (let i = 0; i < value.length; i++) {
        if (i >= 1000 || nodes >= maxNodes || chars >= maxChars) { omitted += value.length - i; break; }
        const child = visit(value[i], depth + 1);
        if (child !== undefined) { result.push(child); chars++; }
      }
      return result;
    }
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {}; chars += 2;
      const entries = Object.entries(value);
      for (let i = 0; i < entries.length; i++) {
        if (i >= 1000 || nodes >= maxNodes || chars >= maxChars) { omitted += entries.length - i; break; }
        const [key, child] = entries[i]!;
        if (key === 'overflowPath' || child === undefined) continue;
        chars += JSON.stringify(key).length + 2;
        const next = visit(child, depth + 1);
        if (next !== undefined) Object.defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    omitted++; return undefined;
  };
  const result = visit(input, 0) as Record<string, unknown>;
  return omitted ? { ...result, detailsTruncated: true, detailsOmitted: omitted } : result;
}
