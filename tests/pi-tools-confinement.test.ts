import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-confined-"));
  roots.push(root);
  const project = path.join(root, "project");
  const sibling = path.join(root, "sibling");
  fs.mkdirSync(project);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, "secret.txt"), "secret\n");
  const registry = new ActionRegistry();
  registry.register(new PiToolsProvider(project));
  const context = {
    cwd: project,
    signal: new AbortController().signal,
    parentToolCallId: "confinement-test",
    nestedToolCallId: "confinement-test-nested",
    extensionContext: { cwd: project } as ExtensionContext,
    update() {},
    approve: async () => {},
    audits: [],
    maxResultChars: 100_000,
  };
  return { root, project, sibling, registry, context };
};

describe("Pi filesystem project-root confinement", () => {
  it("rejects absolute and parent-relative sibling reads and writes", async () => {
    const { project, sibling, registry, context } = fixture();
    const secret = path.join(sibling, "secret.txt");
    await expect(registry.invoke("pi.read", { path: secret }, context))
      .rejects.toThrow(/escapes the project root/);
    await expect(registry.invoke("pi.read", { path: "../sibling/secret.txt" }, context))
      .rejects.toThrow(/escapes the project root/);
    await expect(registry.invoke(
      "pi.write",
      { path: path.join(sibling, "created.txt"), content: "no" },
      context,
    )).rejects.toThrow(/escapes the project root/);
    expect(fs.existsSync(path.join(sibling, "created.txt"))).toBe(false);

    await expect(registry.invoke(
      "pi.write",
      { path: path.join(project, "inside.txt"), content: "yes" },
      context,
    )).resolves.toBeDefined();
    expect(fs.readFileSync(path.join(project, "inside.txt"), "utf8")).toBe("yes");
  });

  it("checks path aliases, nested edit paths, and malformed file URLs", async () => {
    const { project, sibling, registry, context } = fixture();
    await expect(registry.invoke(
      "pi.write",
      { file: path.join(sibling, "alias.txt"), content: "no" },
      context,
    )).rejects.toThrow(/escapes the project root/);

    const provider = new PiToolsProvider(project);
    expect(() => provider.prepareArguments("edit", {
      path: path.join(project, "inside.txt"),
      edits: [{
        path: path.join(sibling, "nested.txt"),
        oldText: "a",
        newText: "b",
      }],
    })).toThrow(/escapes the project root/);
    expect(() => provider.prepareArguments("read", { path: "file://%zz" }))
      .toThrow(/invalid file URL or path/);
  });

  it("accepts the canonical spelling of a symlinked project cwd", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-symlink-cwd-"));
    roots.push(root);
    const target = path.join(root, "target");
    const link = path.join(root, "link");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "inside.txt"), "inside\n");
    try {
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const provider = new PiToolsProvider(link);
    expect(() => provider.prepareArguments("read", {
      path: path.join(target, "inside.txt"),
    })).not.toThrow();
  });

  it("rejects existing and non-existent targets through a symlink or junction", async () => {
    const { project, sibling, registry, context } = fixture();
    const link = path.join(project, "escape");
    try {
      fs.symlinkSync(sibling, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(registry.invoke("pi.read", { path: "escape/secret.txt" }, context))
      .rejects.toThrow(/symlink or junction/);
    await expect(registry.invoke(
      "pi.write",
      { path: "escape/new/deep.txt", content: "no" },
      context,
    )).rejects.toThrow(/symlink or junction/);
    await expect(registry.invoke("pi.ls", { path: "escape" }, context))
      .rejects.toThrow(/symlink or junction/);
    expect(fs.existsSync(path.join(sibling, "new", "deep.txt"))).toBe(false);
  });
});
