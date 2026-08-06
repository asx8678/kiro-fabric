#!/usr/bin/env node
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProgram } from "../checker.js";
import { loadConfig } from "../config.js";
import { getDocs } from "../docs.js";
import { errorObject, exitCode, FabricError } from "../errors.js";
import { installKiro, validateInstalled, verifyPromptManifest } from "../installer.js";
import { KiroHeadlessRunner, runProcess } from "../runners/kiro.js";
import { parseFramed } from "../runners/parser.js";
import { executeProgram } from "../runtime/executor.js";
import { parseArgs, type OutputFormat } from "./args.js";
import { payloadsInput, programInput } from "./input.js";
import { renderCheckText, renderRunText } from "./render.js";
import { updateWritePolicy } from "../write-policy.js";

const usage =
  "fabric-lite <check|run|exec|docs|models|doctor|install-kiro|update-policy> [options]\n" +
  "  run/exec options: --file <path> --format json|text --cwd <dir> --permissions headless|interactive --payloads <file.json>\n" +
  "  check options: --file <path> --format json|text\n" +
  "  docs options: [topic] --compact --format json|text\n" +
  "  doctor options: --cwd <dir> --smoke --format json|text\n" +
  "  install-kiro options: --cwd <dir> --force --dry-run --allow-write read|workspace\n" +
  "  update-policy options: --cwd <dir> --dry-run --allow-write read|workspace\n" +
  "  fresh installs default to editable workspace mutations; use --allow-write read for read-only mode\n" +
  "  update-policy rewrites an existing config to the requested mode without touching other settings\n" +
  "  --permissions interactive prompts a human (Allow once / Allow session / Deny) for ask policies; headless fails closed\n" +
  "  --help / -h shows this usage";
let errorFormat: OutputFormat = "text";

function output(value: unknown, format: OutputFormat): void {
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(value)}\n`
      : typeof value === "string"
        ? value
        : `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function doctor(cwd: string, format: OutputFormat, smoke: boolean): Promise<void> {
  const config = await loadConfig(cwd);
  const runner = new KiroHeadlessRunner(config.runner.executable, config.runner.workerAgent);
  const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: nodeMajor >= 20, detail: process.version });

  try {
    await access(fileURLToPath(new URL("../../types/fabric-lite.d.ts", import.meta.url)));
    checks.push({ name: "package-integrity", ok: true, detail: "CLI and declarations available" });
  } catch (error) {
    checks.push({ name: "package-integrity", ok: false, detail: (error as Error).message });
  }

  const runnerReport = await runner.doctor();
  checks.push({
    name: "kiro",
    ok: runnerReport.ok,
    detail: runnerReport.version ?? runnerReport.message,
  });

  try {
    const result = await runProcess(config.runner.executable, ["whoami"], { timeoutMs: 15000 });
    checks.push({
      name: "authentication",
      ok: result.exitCode === 0,
      detail: result.exitCode === 0 ? "authenticated" : "run kiro-cli login",
    });
  } catch (error) {
    checks.push({ name: "authentication", ok: false, detail: (error as Error).message });
  }

  try {
    const result = await runProcess(config.runner.executable, ["chat", "--help"], {
      timeoutMs: 10000,
    });
    checks.push({
      name: "headless",
      ok: result.exitCode === 0 && result.stdout.includes("no-interactive"),
      detail: "chat --no-interactive",
    });
  } catch (error) {
    checks.push({ name: "headless", ok: false, detail: (error as Error).message });
  }

  const agents = await validateInstalled(config.runner.executable, cwd);
  checks.push({ name: "agents", ok: agents.every((result) => result.ok), detail: agents });
  const promptDrift = await verifyPromptManifest(cwd);
  checks.push({ name: "workspace-prompts", ok: promptDrift.ok, detail: promptDrift });

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabric-lite-doctor-"));
  try {
    await writeFile(path.join(temporaryDirectory, "ok"), "ok");
    checks.push({ name: "temporary-directory", ok: true, detail: temporaryDirectory });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  try {
    const result = await runProcess("git", ["rev-parse", "--show-toplevel"], {
      timeoutMs: 5000,
      cwd,
    });
    checks.push({
      name: "project-root",
      ok: result.exitCode === 0,
      detail: result.stdout.trim() || path.resolve(cwd),
    });
  } catch {
    // Git is a hard requirement (mutation/commit depend on it); a missing or
    // failing git must not report healthy.
    checks.push({
      name: "project-root",
      ok: false,
      detail: "git not available or not a repository",
    });
  }

  if (smoke) {
    try {
      const schema = {
        type: "object",
        properties: { ok: { const: true } },
        required: ["ok"],
        additionalProperties: false,
      };
      const raw = await runner.run({
        instruction: 'Return {"ok":true}.',
        context: "",
        role: "general",
        schema,
        ...(config.runner.defaultModel !== null ? { model: config.runner.defaultModel } : {}),
        maxOutputChars: 1000,
        timeoutMs: config.budgets.aiCallTimeoutMs,
      });
      parseFramed(raw.stdout, schema, 1000);
      checks.push({ name: "paid-semantic-smoke", ok: true });
    } catch (error) {
      checks.push({ name: "paid-semantic-smoke", ok: false, detail: (error as Error).message });
    }
  } else {
    checks.push({
      name: "paid-semantic-smoke",
      ok: true,
      detail: "skipped; pass --smoke to opt in",
    });
  }

  const report = {
    version: 1,
    status: checks.every((check) => check.ok) ? "healthy" : "unhealthy",
    checks,
  };
  output(report, format);
  if (report.status !== "healthy") process.exitCode = 3;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), (format) => {
    errorFormat = format;
  });
  errorFormat = args.format;

  switch (args.command) {
    case "check": {
      const body = await programInput(args.file);
      const result = checkProgram(body);
      if (args.format === "text") {
        output(`${renderCheckText(result, body)}\n`, args.format);
      } else {
        output(
          { version: 1, status: result.ok ? "valid" : "failed", diagnostics: result.diagnostics },
          args.format,
        );
      }
      if (!result.ok) process.exitCode = 2;
      break;
    }
    case "run":
    case "exec": {
      const body = await programInput(args.file);
      const checked = checkProgram(body);
      if (!checked.ok) {
        if (args.format === "text") {
          output(`${renderCheckText(checked, body)}\n`, args.format);
        } else {
          output(
            {
              version: 1,
              runId: "none",
              status: "failed",
              error: {
                code: "TYPECHECK_FAILED",
                message: "Program failed type checking",
                diagnostics: checked.diagnostics,
              },
            },
            args.format,
          );
        }
        process.exitCode = 2;
        break;
      }
      const config = await loadConfig(args.cwd);
      const payloads = args.payloads === undefined ? undefined : await payloadsInput(args.payloads);
      const run = await executeProgram(body, config, {
        permissions: args.permissions,
        progress: args.format === "text",
        diagnostics: checked.diagnostics,
        ...(payloads ? { payloads } : {}),
      });
      if (args.format === "text") {
        const highlight = /^(1|true|yes|on)$/i.test(process.env.FABRIC_LITE_HIGHLIGHT ?? "");
        output(`${renderRunText({ body, envelope: run.envelope }, { highlight })}\n`, args.format);
      } else {
        output(run.envelope, args.format);
      }
      process.exitCode = run.exitCode;
      break;
    }
    case "docs":
      output(getDocs(args.topic, args.compact), args.format);
      break;
    case "models": {
      const config = await loadConfig(args.cwd);
      const runner = new KiroHeadlessRunner(config.runner.executable, config.runner.workerAgent);
      output({ version: 1, models: await runner.listModels() }, args.format);
      break;
    }
    case "doctor":
      await doctor(args.cwd, args.format, args.smoke);
      break;
    case "install-kiro": {
      const config = await loadConfig(args.cwd);
      const result = await installKiro({
        root: path.resolve(args.cwd),
        cliPath: fileURLToPath(import.meta.url),
        executable: config.runner.executable,
        force: args.force,
        dryRun: args.dryRun,
        writeAccess: args.writeAccess,
      });
      output(result, args.format);
      break;
    }
    case "update-policy": {
      const result = await updateWritePolicy({
        root: path.resolve(args.cwd),
        writeAccess: args.writeAccess,
        dryRun: args.dryRun,
      });
      output(result, args.format);
      break;
    }
    default:
      if (args.help) {
        process.stdout.write(`${usage}\n`);
      } else if (errorFormat === "json") {
        output(
          {
            version: 1,
            status: "failed",
            error: {
              code: "RUNTIME_FAILED",
              message: args.command ? `Unknown command: ${args.command}` : "No command provided",
            },
          },
          errorFormat,
        );
        process.exitCode = 3;
      } else {
        process.stderr.write(`${usage}\n`);
        process.exitCode = 3;
      }
  }
}

main().catch((error: unknown) => {
  output({ version: 1, status: "failed", error: errorObject(error) }, errorFormat);
  process.exitCode = error instanceof FabricError ? exitCode(error.code) : 3;
});
