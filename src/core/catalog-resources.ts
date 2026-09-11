import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
/** Conservative retained heap accounting, including tree/container overhead.
 * Strings count as UTF-16 plus UTF-8 serialization; shared copies are charged
 * again (never undercounted). Caller reserves lazy projection/index overhead. */
export const catalogWeight = (value: unknown): { bytes: number; nodes: number } => {
  const text = fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  let nodes = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop(); nodes++;
    if (current !== null && typeof current === "object") stack.push(...Object.values(current));
  }
  return { bytes: text.length * 2 + Buffer.byteLength(text) + nodes * 48, nodes };
};
