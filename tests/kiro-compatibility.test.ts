import { execFileSync } from "node:child_process";
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
import { withPrivateKiroLauncherFixtures } from "../src/kiro/compatibility-test-seam.js";

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

    const identity = await withPrivateKiroLauncherFixtures([target], () => assertSupportedKiro(alias));
    try {
      expect(identity).toMatchObject({
        state: "ok",
        sourcePath: target,
        executablePath: expect.stringContaining("kiro-fabric-kiro-stage-"),
        version: KIRO_CLI_VERSION,
      });
      expect(identity.executablePath).not.toBe(target);
    } finally {
      identity.dispose();
    }
  });

  it("executes staged attested bytes after the external source path is replaced", async () => {
    const root = scratch();
    const source = join(root, "kiro-cli");
    writeFileSync(source, [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "kiro-cli 2.20.1"; else echo original; fi',
      "",
    ].join("\n"), { mode: 0o755 });
    const identity = await withPrivateKiroLauncherFixtures([source], () => assertSupportedKiro(source));
    try {
      writeFileSync(source, "#!/bin/sh\necho replacement\n", { mode: 0o755 });
      expect(execFileSync(identity.executablePath, ["proof"], { encoding: "utf8" }).trim())
        .toBe("original");
    } finally {
      identity.dispose();
    }
  });

  it("rejects wrong-product and uncertified-newer executables", async () => {
    const root = scratch();
    const wrong = executable(root, "wrong", `other-cli ${KIRO_CLI_VERSION}`);
    const newer = executable(root, "newer", "kiro-cli 2.21.0");

    await withPrivateKiroLauncherFixtures([wrong], async () => {
      await expect(assertSupportedKiro(wrong)).rejects.toThrow(/wrong product/i);
    });
    await withPrivateKiroLauncherFixtures([newer], async () => {
      await expect(assertSupportedKiro(newer)).rejects.toThrow(/uncertified newer/i);
      await expect(inspectKiroCompatibility(newer)).resolves.toMatchObject({
        state: "newer",
        executablePath: newer,
        ok: false,
      });
    });
  });

  it("rejects a shebang launcher on the production compatibility path", async () => {
    const launcher = executable(scratch(), "kiro-script", `kiro-cli ${KIRO_CLI_VERSION}`);
    await expect(assertSupportedKiro(launcher)).rejects.toThrow(/unsupported Kiro launcher artifact/i);
  });
});
