import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countFileComplexity,
  MAX_COMPLEXITY_FILE_BYTES,
} from "../src/state/complexity.js";

const roots: string[] = [];
const temporaryDirectory = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-complexity-security-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("state complexity file confinement", () => {
  it("counts bounded regular files inside the canonical workspace", () => {
    const root = temporaryDirectory();
    const file = path.join(root, "source.ts");
    fs.writeFileSync(file, "if (ready) { while (active) work(); }\n");
    expect(countFileComplexity(file, root)).toMatchObject({ count: 2 });
  });

  it("rejects final and intermediate symlinks that escape the workspace", () => {
    const root = temporaryDirectory();
    const outside = temporaryDirectory();
    const secret = path.join(outside, "secret.ts");
    fs.writeFileSync(secret, "if (secret) reveal();\n");
    const direct = path.join(root, "direct.ts");
    fs.symlinkSync(secret, direct);
    expect(() => countFileComplexity(direct, root)).toThrow(/symlink/i);

    const linkedDirectory = path.join(root, "linked");
    fs.symlinkSync(outside, linkedDirectory, "dir");
    expect(() => countFileComplexity(path.join(linkedDirectory, "secret.ts"), root))
      .toThrow(/outside the project cwd/i);
  });

  it("rejects oversized inputs before reading their contents", () => {
    const root = temporaryDirectory();
    const file = path.join(root, "large.ts");
    fs.writeFileSync(file, "");
    fs.truncateSync(file, MAX_COMPLEXITY_FILE_BYTES + 1);
    expect(() => countFileComplexity(file, root)).toThrow(/exceeds/);
  });
});
