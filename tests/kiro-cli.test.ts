import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runKiroCli } from "../src/kiro/cli.js";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };

const capture = () => {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as never);
  return { stdout: () => stdout, stderr: () => stderr };
};

afterEach(() => vi.restoreAllMocks());

describe("Kiro management CLI diagnostics", () => {
  it("supports version and command-specific help", async () => {
    const output = capture();
    await expect(runKiroCli(["--version"])).resolves.toBe(0);
    expect(output.stdout()).toBe(`${pkg.version}\n`);
    expect(output.stderr()).toBe("");

    vi.restoreAllMocks();
    const help = capture();
    await expect(runKiroCli(["mcp", "--help"])).resolves.toBe(0);
    await expect(runKiroCli(["doctor", "power", "--help"])).resolves.toBe(0);
    expect(help.stdout()).toContain("mcp --integration");
    expect(help.stdout()).toContain("doctor power");
    expect(help.stderr()).toBe("");
  });

  it("classifies invalid integration as a usage error", async () => {
    const output = capture();
    await expect(runKiroCli(["mcp", "--integration", "invalid"])).resolves.toBe(2);
    expect(output.stderr()).toContain("must be one of");
    expect(output.stderr()).toContain("Usage:");
  });

  it("returns exactly one JSON error without a stack unless debug is requested", async () => {
    const output = capture();
    const missing = "/definitely/missing/kiro-fabric-cli-test";
    await expect(runKiroCli([
      "doctor", "kiro", "--project-root", missing, "--json",
    ])).resolves.toBe(1);
    const parsed = JSON.parse(output.stdout()) as { ok: boolean; error: { message: string } };
    expect(parsed).toMatchObject({ ok: false });
    expect(parsed.error.message).toContain("project root does not exist");
    expect(output.stderr()).toBe("");
    expect(output.stdout()).not.toContain(" at ");

    vi.restoreAllMocks();
    const debug = capture();
    await expect(runKiroCli([
      "doctor", "kiro", "--project-root", missing, "--debug",
    ])).resolves.toBe(1);
    expect(debug.stderr()).toContain("project root does not exist");
    expect(debug.stderr()).toMatch(/KiroInstallError|runKiroCli/);
  });
});
