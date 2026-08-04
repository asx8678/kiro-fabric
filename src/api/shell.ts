import { lstat, realpath } from "node:fs/promises";
import { FabricError } from "../errors.js";
import type { FabricLiteApi } from "../../types/fabric-lite.js";
import { shellRequest } from "../permissions.js";
import { safePath } from "./paths.js";
import { command } from "./command.js";
import { aliasedArguments, optionalNumber, positionalArguments, requiredString } from "./args.js";
import type { ApiContext } from "./context.js";

export function createShellApi(ctx: ApiContext): FabricLiteApi["shell"] {
  const { config, root, gate } = ctx;
  const shell: FabricLiteApi["shell"] = {
    async run(...args: unknown[]) {
      const input = aliasedArguments(positionalArguments("fabric.shell.run", args, ["command"]), {
        cmd: "command",
        shell: "command",
        cmdline: "command",
      }) as {
        command: string;
        timeoutMs?: number;
        timeout?: number;
        maxOutputChars?: number;
        cwd?: string;
      };
      if (input.timeout !== undefined && input.timeoutMs === undefined)
        input.timeoutMs = Number(input.timeout) * 1000;
      requiredString("fabric.shell.run", input.command, "command");
      optionalNumber("fabric.shell.run", input.timeoutMs, "timeoutMs");
      optionalNumber("fabric.shell.run", input.maxOutputChars, "maxOutputChars");
      if (!config.shell.enabled)
        throw new FabricError("POLICY_DENIED", "Shell is disabled by project policy");
      if (typeof input?.command !== "string" || input.command.length === 0)
        throw new FabricError("POLICY_DENIED", "Shell command must be a non-empty string");
      const requestedCwd = await safePath(root, input.cwd ?? ".");
      const canonicalCwd = await realpath(requestedCwd);
      const cwdInfo = await lstat(canonicalCwd);
      if (!cwdInfo.isDirectory())
        throw new FabricError("POLICY_DENIED", "Shell cwd must be a directory");
      const cwd = canonicalCwd;
      const request = shellRequest(input.command, cwd);
      if (!(await gate.authorize(request)))
        throw new FabricError(
          "POLICY_DENIED",
          request.category === "destructive"
            ? "Destructive commands are denied by policy"
            : "Shell command was not approved",
        );
      const max = Math.min(
        input.maxOutputChars ?? config.shell.maxOutputChars,
        config.shell.maxOutputChars,
      );
      const r = await command(
        [process.env.SHELL ?? "/bin/sh", "-c", input.command],
        cwd,
        Math.min(input.timeoutMs ?? config.shell.timeoutMs, config.shell.timeoutMs),
        { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1" },
        max,
      );
      return {
        command: input.command,
        exitCode: r.code,
        stdout: r.stdout,
        stderr: r.stderr,
        truncated: r.stdoutTruncated || r.stderrTruncated,
        timedOut: r.timedOut,
      };
    },
  };
  return shell;
}
