import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSupportedKiro,
  classifyKiroVersionOutput,
  classifyNodeVersion,
  inspectKiroCompatibility,
  KIRO_CLI_VERSION,
} from "../src/kiro/compatibility.js";

const roots: string[] = [];
const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "kiro-fabric-compatibility-"));
  roots.push(root);
  return root;
};

const executable = (root: string, name: string, output: string): string => {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("central Kiro/Node compatibility policy", () => {
  it.each([
    ["kiro-cli 2.20.1", "ok"],
    ["kiro 2.20.1", "wrong-product"],
    ["kiro-cli 2.20.1\nnode 24.0.0", "ambiguous"],
    ["kiro-cli 2.20.1-beta.1", "prerelease"],
    ["kiro-cli 2.20.2", "newer"],
    ["kiro-cli 2.19.9", "older"],
  ])("classifies strict product output %j as %s", (output, state) => {
    expect(classifyKiroVersionOutput(output)).toMatchObject({ state });
  });

  it("accepts only stable Node >=24", () => {
    expect(classifyNodeVersion("24.0.0", "node", "/node").state).toBe("ok");
    expect(classifyNodeVersion("23.9.0", "node", "/node").state).toBe("unsupported");
    expect(classifyNodeVersion("24.0.0-rc.1", "node", "/node").state).toBe("prerelease");
  });

  it("persists the real canonical executable behind a symlink", async () => {
    const root = scratch();
    const target = executable(root, "kiro-real", `kiro-cli ${KIRO_CLI_VERSION}`);
    const alias = join(root, "kiro-cli");
    symlinkSync(target, alias);

    await expect(assertSupportedKiro(alias)).resolves.toMatchObject({
      state: "ok",
      executablePath: target,
      version: KIRO_CLI_VERSION,
    });
  });

  it("rejects wrong-product and uncertified-newer executables", async () => {
    const root = scratch();
    const wrong = executable(root, "wrong", `other-cli ${KIRO_CLI_VERSION}`);
    const newer = executable(root, "newer", "kiro-cli 2.21.0");

    await expect(assertSupportedKiro(wrong)).rejects.toThrow(/wrong product/i);
    await expect(assertSupportedKiro(newer)).rejects.toThrow(/uncertified newer/i);
    await expect(inspectKiroCompatibility(newer)).resolves.toMatchObject({
      state: "newer",
      executablePath: newer,
      ok: false,
    });
  });
});
