// Built-artifact host-free assertion: the Kiro MCP server's own static import
// graph must not statically import the Pi UI/session layer (pi-tui approval
// rendering, mariozechner pi-* session APIs). pi-coding-agent is legitimately
// imported for core tool *definitions* (which run headless); its own internal
// interactive-UI barrel is the host package's concern, not the adapter's.
//
// This is a deterministic static-graph check (the ESM loader-hook variant is
// unreliable across Node's worker-based hook threading).

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const entry = "dist/kiro/mcp-entry.js";

const staticImportRe = /(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;

const collectGraph = (root: string): Set<string> => {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of src.matchAll(staticImportRe)) {
      const spec = match[1]!;
      if (spec.startsWith(".")) {
        let resolved = normalize(join(dirname(file), spec));
        if (!resolved.endsWith(".js")) resolved += ".js";
        stack.push(resolved);
      }
    }
  }
  return seen;
};

describe.skipIf(!existsSync(entry))("Kiro MCP built artifact static graph", () => {
  it("statically imports no Pi UI/session packages from adapter code", () => {
    const graph = collectGraph(entry);
    const violations: string[] = [];
    for (const file of graph) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const match of src.matchAll(staticImportRe)) {
        const spec = match[1]!;
        if (spec === "@earendil-works/pi-tui" || spec.includes("@mariozechner/pi-")) {
          violations.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(graph.size).toBeGreaterThan(0);
  });
});
