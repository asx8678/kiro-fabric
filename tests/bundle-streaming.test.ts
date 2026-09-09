import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createBundleManifest, validateBundle } from "../scripts/bundle-contract.mjs";
import { fixture } from "./bundle-fixture.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it.each([0, 65536, 65537, 2 * 1024 * 1024])("hashes %i-byte inventory members in <=64KiB buffers with identical SHA-256", async size => {
  const root = await fixture(); roots.push(root); const previous = await validateBundle(root);
  const bytes = Buffer.alloc(size, 37); await fs.writeFile(path.join(root, "app/main.js"), bytes);
  const expected = createHash("sha256").update(bytes).digest("hex");
  const allocations = vi.spyOn(Buffer, "alloc");
  const manifest = await createBundleManifest(root, previous.manifest);
  expect(manifest.inventory.find((e: { path: string }) => e.path === "app/main.js")).toMatchObject({ size, sha256: expected });
  expect(allocations.mock.calls.length).toBeGreaterThan(0);
  expect(Math.max(...allocations.mock.calls.map(([size]) => size))).toBeLessThanOrEqual(65536);
});
it.each(["grow", "shrink", "same-size"])("rejects %s mutation while streaming an inventory member", async mutation => {
  const root = await fixture(); roots.push(root); const previous = await validateBundle(root);
  const target = path.join(root, "app/main.js"); await fs.writeFile(target, Buffer.alloc(150000, 37));
  const open = fs.open;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (String(args[0]) === target) {
      const read = handle.read.bind(handle); let changed = false;
      vi.spyOn(handle, "read").mockImplementation((async (...readArgs: unknown[]) => {
        const result = await (read as Function)(...readArgs);
        if (!changed) {
          changed = true;
          await fs.writeFile(target, Buffer.alloc(mutation === "grow" ? 160000 : mutation === "shrink" ? 140000 : 150000, 38));
        }
        return result;
      }) as typeof handle.read);
    }
    return handle;
  });
  syncBuiltinESMExports();
  await expect(createBundleManifest(root, previous.manifest)).rejects.toThrow(/File changed/);
});
