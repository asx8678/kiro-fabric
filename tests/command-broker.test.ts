import { describe, expect, it } from "vitest";
import { CommandBroker, SOURCE_OF_TRUTH, type CommandMeta } from "../src/core/command-broker.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const broker = (): CommandBroker => new CommandBroker(mkdtempSync(join(tmpdir(), "cmd-broker-test-")));

const meta = (over: Partial<CommandMeta> = {}): CommandMeta => ({
  command: "echo",
  args: ["hello"],
  commit: "abc123",
  treeHash: "tree1",
  cwd: process.cwd(),
  ...over,
});

describe("CommandBroker", () => {
  it("executes once and serves the cached result for identical commands", async () => {
    const b = broker();
    const first = await b.execute(meta());
    const second = await b.execute(meta());
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.stdout).toBe(first.stdout);
    expect(second.stdout.trim()).toBe("hello");
  });

  it("dedupes concurrent identical executions to a single run", async () => {
    const b = broker();
    const [r1, r2, r3] = await Promise.all([b.execute(meta()), b.execute(meta()), b.execute(meta())]);
    const cached = [r1, r2, r3].filter((r) => r.cached);
    expect(cached.length).toBe(2); // one executed, two served from the in-flight dedupe/cache
  });

  it("keys results so different tree-hash or args miss the cache", async () => {
    const b = broker();
    await b.execute(meta());
    const treeB = await b.execute(meta({ treeHash: "tree2" }));
    expect(treeB.cached).toBe(false);
  });

  it("exposes source-of-truth command mappings for binary facts", async () => {
    expect(SOURCE_OF_TRUTH["file-tracked"]).toEqual({ command: "git", args: ["ls-files"] });
    expect(SOURCE_OF_TRUTH["tree-clean"]).toEqual({ command: "git", args: ["status", "--porcelain"] });
    const b = broker();
    const result = await b.sourceOfTruth("pinned-commit", meta());
    expect(result.stdout.trim()).toBeTruthy(); // git rev-parse HEAD succeeded
  });

  it("changes the host tree identity for same-status tracked and untracked rewrites", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmd-broker-tree-"));
    const git = (args: string[]): void => {
      execFileSync("git", args, { cwd, stdio: "ignore" });
    };
    git(["init"]);
    git(["config", "user.email", "fabric@example.invalid"]);
    git(["config", "user.name", "Fabric Test"]);
    writeFileSync(join(cwd, "tracked.txt"), "alpha\n");
    git(["add", "tracked.txt"]);
    git(["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);

    const clean = CommandBroker.treeHash(cwd);
    writeFileSync(join(cwd, "tracked.txt"), "omega\n");
    const trackedRewrite = CommandBroker.treeHash(cwd);
    expect(clean).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(trackedRewrite).not.toBe(clean);

    writeFileSync(join(cwd, "untracked.txt"), "first\n");
    const untrackedFirst = CommandBroker.treeHash(cwd);
    writeFileSync(join(cwd, "untracked.txt"), "other\n");
    const untrackedRewrite = CommandBroker.treeHash(cwd);
    expect(untrackedRewrite).not.toBe(untrackedFirst);
  });

  it("changes the host tree identity for same-status rewrites inside a nested repository", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmd-broker-nested-tree-"));
    const git = (workingDirectory: string, args: string[]): void => {
      execFileSync("git", args, { cwd: workingDirectory, stdio: "ignore" });
    };
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "fabric@example.invalid"]);
    git(cwd, ["config", "user.name", "Fabric Test"]);
    writeFileSync(join(cwd, "tracked.txt"), "outer\n");
    git(cwd, ["add", "tracked.txt"]);
    git(cwd, ["-c", "commit.gpgsign=false", "commit", "-m", "outer"]);

    const nested = join(cwd, "nested");
    mkdirSync(nested);
    git(nested, ["init"]);
    git(nested, ["config", "user.email", "fabric@example.invalid"]);
    git(nested, ["config", "user.name", "Fabric Test"]);
    writeFileSync(join(nested, "inside.txt"), "alpha\n");
    git(nested, ["add", "inside.txt"]);
    git(nested, ["-c", "commit.gpgsign=false", "commit", "-m", "nested"]);

    writeFileSync(join(nested, "inside.txt"), "first\n");
    const first = CommandBroker.treeHash(cwd);
    writeFileSync(join(nested, "inside.txt"), "other\n");
    const other = CommandBroker.treeHash(cwd);

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(other).not.toBe(first);
  });

  it("recordExternal marks the artifact as cached for later readers", async () => {
    const b = broker();
    const m = meta({ command: "mix", args: ["test", "--cover"] });
    b.recordExternal(m, "COV 100%");
    const served = await b.execute(m);
    expect(served.cached).toBe(true);
    expect(served.stdout).toBe("COV 100%");
  });
});
