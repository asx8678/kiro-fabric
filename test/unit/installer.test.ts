import { expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installKiro } from "../../src/installer.js";

it("dry-run previews existing conflicts without overwriting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-install-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; exit 0; fi\nexit 0\n");
    await chmod(executable, 0o755);
    await mkdir(path.join(root, ".fabric-lite"));
    const configPath = path.join(root, ".fabric-lite/config.json");
    await writeFile(configPath, "existing\n");
    const result = await installKiro({ root, cliPath: "dist/cli/main.js", executable, force: false, dryRun: true });
    expect(result.conflicts).toContain(configPath);
    expect(await import("node:fs/promises").then(fs => fs.readFile(configPath, "utf8"))).toBe("existing\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});