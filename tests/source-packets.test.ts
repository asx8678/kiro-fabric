import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import type { LocalReadManyResult, LocalReadWindow } from "../src/providers/local-contract.js";

const fixtures: { base: string; runtime: KiroRuntime }[] = [];
afterEach(async () => {
  for (const { base, runtime } of fixtures.splice(0)) {
    await runtime.close();
    removeFixtureSync(base, { recursive: true, force: true });
  }
});
function fixture(maxOutputChars = 50000, maxNestedResultChars = 2_000_000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-source-packet-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const runtime = createKiroRuntime({
    cwd: root, workspaceRoot: root, localLockRoot: path.join(base, "locks"),
    artifactsRoot: path.join(base, "artifacts"), configFile: path.join(base, "config.json"),
    mcpConfigPath: path.join(base, "mcp.json"),
    config: normalizeFabricConfig({
      executor: { timeoutMs: 10000, maxOutputChars, maxNestedResultChars },
      mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false },
    }),
  });
  fixtures.push({ base, runtime });
  const execute = (code: string, payloads: Record<string, string>) => runtime.service.execute({
    code, payloads,
    approver: {
      prepareApproval(action) { expect(action.risk).toBe("read"); return { decision: "allow" as const }; },
      async approve() { throw new Error("Unexpected approval for read-only test"); },
    },
  });
  return { root, runtime, execute };
}

describe("source evidence through runtime, checked guest and visible MCP projection", () => {
  it("halves source-return round trips for a 27k cross-file packet without hiding evidence in an artifact", async () => {
    const f = fixture();
    const input = {
      "routes.ts": Array.from({ length: 220 }, (_, i) => `route(${i}, { target: "worker-${i}", retry: false, description: "${"configuration ".repeat(4)}" });`).join("\n"),
      "dispatch.ts": "export function dispatch(request, routes) { return routes[request.kind](request); }",
      "caller.ts": "dispatch(request, routes);",
    };
    for (const [file, source] of Object.entries(input)) fs.writeFileSync(path.join(f.root, file), source);
    const expected = Object.entries(input).map(([file, source]) => [file, source.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n")]);
    const counts: number[] = [];
    for (const maxChars of [16000, undefined]) {
      let windows: LocalReadWindow[] = Object.keys(input).map(file => ({ path: file, limit: 2000 }));
      const received = new Map<string, string[]>();
      let calls = 0;
      while (windows.length) {
        expect(++calls).toBeLessThan(4);
        const result = await f.execute(`return await local.readMany({windows:JSON.parse(payloads.windows) as LocalReadWindow[]${maxChars ? `,maxChars:${maxChars}` : ""}});`, { windows: JSON.stringify(windows) });
        expect(result.success, result.error).toBe(true);
        expect(result.audits.map(audit => audit.ref)).toEqual(["local.readMany"]);
        // Both the default compact transport and explicit pretty JSON must carry all source.
        for (const resultFormat of ["auto", "json"] as const) {
          const projected = projectFabricExecutionText({ result, resultFormat, maxOutputChars: 50000, writeArtifact() { throw new Error("Unexpected artifact spill"); } });
          expect(projected.overflowed).toBe(false);
          expect(projected.isError).toBe(false);
          expect(JSON.parse(projected.text)).toEqual(result.value);
        }
        const page = result.value as LocalReadManyResult;
        for (const file of page.files) received.set(file.path, [...(received.get(file.path) ?? []), file.source]);
        windows = page.remaining;
      }
      expect([...received].map(([file, chunks]) => [file, chunks.join("\n")])).toEqual(expected);
      counts.push(calls);
    }
    expect(counts).toEqual([2, 1]);
  });

  it.each([[1000, 2_000_000], [5000, 2_000_000], [50000, 4000]])("clamps a 40000 request with output=%i and nested=%i, retaining exact continuations", async (output, nested) => {
    const f = fixture(output, nested);
    fs.writeFileSync(path.join(f.root, "input"), "boundary \"quoted\" 🛰\n".repeat(600));
    const first = await f.execute('return await local.readMany({windows:[{path:"input",limit:2000}],maxChars:40000});', {});
    expect(first.success, first.error).toBe(true);
    const page = first.value as LocalReadManyResult;
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(Math.min(40000, nested, Math.floor(output * 0.8)));
    expect(page).toMatchObject({ complete: false, remaining: [{ path: "input", expectedSha256: page.files[0]!.sha256, offset: page.files[0]!.endLine! + 1 }] });
    const projected = projectFabricExecutionText({ result: first, resultFormat: "auto", maxOutputChars: output, writeArtifact() { throw new Error("Unexpected artifact spill"); } });
    expect(projected.overflowed).toBe(false);
    expect(JSON.parse(projected.text)).toEqual(page);
    const second = await f.execute('return await local.readMany({windows:JSON.parse(payloads.windows) as LocalReadWindow[],maxChars:40000});', { windows: JSON.stringify(page.remaining) });
    expect(second.success, second.error).toBe(true);
    expect((second.value as LocalReadManyResult).files[0]!.startLine).toBe(page.files[0]!.endLine! + 1);
  });
});
