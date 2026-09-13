import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
/** Conservative retained heap accounting, including tree/container overhead.
 * Strings count as UTF-16 plus UTF-8 serialization; shared copies are charged
 * again (never undercounted). Caller reserves lazy projection/index overhead. */
const MAX_CATALOG_NODES = 100_000;
export const catalogWeight = (value: unknown, maxChars = MAX_FABRIC_JSON_CHARS): { bytes: number; nodes: number } => {
  const text = fabricJsonText(value, maxChars);
  let nodes = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop(); nodes++;
    // fabricJsonText already proved this graph is acyclic and within the node
    // budget; this cap keeps the traversal independently terminating even if
    // that contract regresses, so accounting can never hang the host.
    if (nodes > MAX_CATALOG_NODES) throw new Error("Fabric host JSON is outside the bounded JSON contract: node limit exceeded");
    if (current !== null && typeof current === "object") stack.push(...Object.values(current));
  }
  return { bytes: text.length * 2 + Buffer.byteLength(text) + nodes * 48, nodes };
};
