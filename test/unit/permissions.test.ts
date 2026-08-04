import { realpath } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  PermissionGate,
  classifyShell,
  commitRequest,
  headlessPrompter,
  interactivePrompter,
  isDestructive,
  shellRequest,
  type ApprovalPrompter,
  type PermissionRequest,
} from "../../src/permissions.js";
import { defaultPermissions } from "../../src/permissions.js";

describe("permission classification", () => {
  it("detects destructive shell commands and leaves ordinary reads alone", () => {
    for (const command of [
      "rm -rf .",
      "rm -r -f .",
      "rm --recursive --force /",
      "/usr/local/sbin/rm --force --recursive /",
      "sudo env FOO=bar command /opt/tools/rm -f -r /",
      "sh -c 'command /bin/rm --recursive --force /'",
      "git push origin main",
      "git --no-pager push origin main",
      "git -c core.pager=cat push origin main",
      "git reset --hard HEAD",
      "git --no-pager reset HEAD",
      "git --no-pager reset --hard HEAD",
      "git -c core.pager=cat reset --hard HEAD",
      "git clean -fdx",
      "git --no-pager clean",
      "git --no-pager clean -fdx",
      "git -c core.pager=cat clean -fdx",
      "printf '%s' \"$(git push origin main)\"",
      "printf '%s' `git reset --hard HEAD`",
      "psql -c 'drop database app'",
      "mkfs.ext4 /dev/sda",
    ]) {
      expect(isDestructive(command), command).toBe(true);
    }
    for (const command of [
      "git status",
      "git log --oneline",
      "cat package.json",
      "ls -la",
    ]) {
      expect(isDestructive(command), command).toBe(false);
      expect(classifyShell(command).category).toBe("execute");
    }
  });

  it("builds exact action/args previews for commit and shell", () => {
    const commit = commitRequest("fix: typo", "/repo", ["/repo/a.ts", "/repo/b.ts"]);
    expect(commit.category).toBe("commit");
    expect(commit.preview).toContain('"message":"fix: typo"');
    expect(commit.preview).toContain('"paths":["/repo/a.ts","/repo/b.ts"]');
    // The structured action identity is collision-free and matches the preview.
    expect(commit.action).toBe(JSON.stringify({
      operation: "local-commit",
      repository: "/repo",
      message: "fix: typo",
      paths: ["/repo/a.ts", "/repo/b.ts"],
    }));
    const dead = shellRequest("rm -rf .", "/repo");
    expect(dead.category).toBe("destructive");
    expect(dead.preview).toContain('"command":"rm -rf ."');
    expect(dead.command).toBe("rm -rf .");
    expect(dead.cwd).toBe("/repo");
    const benign = shellRequest("git status", "/repo");
    expect(benign.category).toBe("execute");
  });
});

describe("PermissionGate", () => {
  const record: PermissionRequest[] = [];
  const prompter: ApprovalPrompter = async (request) => {
    record.push(request);
    return "allow";
  };

  it("allows read, denies destructive, and is default-deny headlessly", async () => {
    const gate = new PermissionGate({ policy: defaultPermissions, prompter: headlessPrompter });
    expect(await gate.authorize({ category: "read", action: "x", preview: "read x" })).toBe(true);
    expect(await gate.authorize({ category: "destructive", action: "x", preview: "rm -rf" })).toBe(false);
    expect(await gate.authorize({ category: "commit", action: "commit:m:p", preview: "commit" })).toBe(false);
    expect(await gate.authorize({ category: "execute", action: "shell:git status", preview: "shell" })).toBe(false);
  });

  it("surfaces ask prompts with previews and honors allowed execute commands without prompting", async () => {
    const gate = new PermissionGate({
      policy: defaultPermissions,
      prompter,
      allowedCommands: ["git status"],
      projectRoot: process.cwd(),
    });
    // Allowlisted commands run without prompting only at the project root.
    expect(await gate.authorize({
      category: "execute",
      action: "git status",
      preview: "shell: git status",
      command: "git status",
      cwd: await realpath(process.cwd()),
    })).toBe(true);
    expect(record).toHaveLength(0);
    await expect(
      gate.authorize({ category: "execute", action: "pnpm test", preview: "shell: pnpm test" }),
    ).resolves.toBe(true);
    expect(record).toHaveLength(1);
    expect(record[0]?.preview).toContain("pnpm test");
  });

  it("honors allow-session for the risk category but not for other categories", async () => {
    // Official Fabric semantics: a session grant covers the whole risk class
    // for the lifetime of the gate, never other classes.
    const prompted: PermissionRequest[] = [];
    let answer: "session" | "deny" | "allow" = "session";
    const gate = new PermissionGate({
      policy: defaultPermissions,
      prompter: async (request) => {
        prompted.push(request);
        return answer;
      },
    });
    const req = { category: "commit" as const, action: "commit:m:p", preview: "commit m p" };
    expect(await gate.authorize(req)).toBe(true);
    // Any commit action in the same session no longer prompts.
    answer = "deny";
    expect(await gate.authorize(req)).toBe(true);
    expect(await gate.authorize({ ...req, action: "commit:m2:p2" })).toBe(true);
    expect(prompted).toHaveLength(1);
    // A different risk category still prompts and fails closed on deny.
    expect(await gate.authorize({ category: "execute", action: "shell:x", preview: "shell x" })).toBe(false);
    expect(prompted).toHaveLength(2);
  });

  it("denies destructive even when policy says allow and approval is granted", async () => {
    const gate = new PermissionGate({
      policy: { ...defaultPermissions, destructive: "allow" },
      prompter: async () => "allow",
    });
    expect(await gate.authorize({ category: "destructive", action: "rm -rf", preview: "rm" })).toBe(false);
  });

  it("interactive prompter fails closed when the controlling terminal is unavailable", async () => {
    // In the test runner there is no controlling /dev/tty, so the prompter
    // must resolve to deny rather than crash.
    const response = await interactivePrompter({
      category: "execute",
      action: "echo hi",
      preview: "shell: echo hi",
    });
    expect(response).toBe("deny");
  });
});