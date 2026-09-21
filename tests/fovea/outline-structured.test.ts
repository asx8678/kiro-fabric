import { removeFixtureSync } from "../fixture-cleanup.mjs";
import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { coreContext, type CoreContext } from "../../src/fovea/core/context.js";
import { outlineStructured, type OutlineFile } from "../../src/fovea/core/astgrep.js";

const realParser = path.resolve(".tmp/fovea-parser/ast-grep");

function contextFor(parser: string, root: string): CoreContext {
  return { store: new Map(), sessionStore: new Map(), parserPath: parser, storageRoot: root,
    sourceRoot: root, snapshotRoot: root, signal: new AbortController().signal, gitFailures: [], focusKey: "outline", spills: new Map() };
}

// A real ast-grep exits 0 with non-empty JSON even for symbol-less and
// unparseable files (`items: []`), so the demotion branch under test below
// is unreachable for supported binaries. Pin that observed behavior: a
// mixed batch keeps every requested file, in requested order, with real
// symbols where they exist.
it.skipIf(!fs.existsSync(realParser))("structured outline keeps symbol-less and unparseable files in batch order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fovea-outline-"));
  try {
    fs.writeFileSync(path.join(root, "empty.ts"), "// no declarations\n");
    fs.writeFileSync(path.join(root, "broken.ts"), "export function broken( {\n");
    fs.writeFileSync(path.join(root, "good.ts"), "export function good() { return 1 }\n");
    // Request order intentionally differs from alphabetical so the
    // positions-sort (not the binary's own ordering) is what is pinned.
    const files = [path.join(root, "good.ts"), path.join(root, "broken.ts"), path.join(root, "empty.ts")];
    let result: OutlineFile[] | undefined;
    await coreContext.run(contextFor(realParser, root), async () => {
      result = await outlineStructured(files, "TypeScript", root);
    });
    expect(result).toBeDefined();
    expect(result!.map((f) => path.basename(f.path))).toEqual(["good.ts", "broken.ts", "empty.ts"]);
    const good = result!.find((f) => path.basename(f.path) === "good.ts");
    expect(good?.items.some((i) => i.name === "good")).toBe(true);
    expect(result!.filter((f) => f !== good).every((f) => f.items.length === 0)).toBe(true);
  } finally {
    removeFixtureSync(root, { recursive: true });
  }
});

// Empty, silent or garbage output can only come from a binary whose
// structured interface is unavailable. The batch must demote (undefined) so
// the text-outline fallback records the genuine failure and still recovers
// symbols when the text interface works. Never parse a failed run's stdout.
it("demotes to the text outline when the structured interface fails or stays silent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fovea-outline-stub-"));
  try {
    const cases: Array<[string, string]> = [
      ["silent-exit", "#!/bin/sh\nexit 1\n"],
      ["empty-ok", "#!/bin/sh\nexit 0\n"],
      ["garbage-ok", "#!/bin/sh\necho 'not json'\n"],
    ];
    const file = path.join(root, "good.ts");
    fs.writeFileSync(file, "export function good() { return 1 }\n");
    for (const [name, script] of cases) {
      const stub = path.join(root, `${name}.sh`);
      fs.writeFileSync(stub, script, { mode: 0o755 });
      let result: OutlineFile[] | undefined;
      await coreContext.run(contextFor(stub, root), async () => {
        result = await outlineStructured([file], "TypeScript", root);
      });
      expect(result, name).toBeUndefined();
    }
  } finally {
    removeFixtureSync(root, { recursive: true });
  }
});
