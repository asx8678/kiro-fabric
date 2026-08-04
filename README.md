# Kiro Fabric

Kiro Fabric is a local runtime that lets TypeScript programs use Kiro CLI as a structured reasoning backend. Instead of relying on one free-form chat prompt, Kiro writes a small checked TypeScript script for the task. That script uses the `fabric` API to gather only the project context it needs, then invokes the Kiro LLM programmatically with explicit instructions, input data, and an optional JSON Schema. The script receives parsed, schema-checked data—not an unstructured chat response—and can inspect, transform, save, or return the result as JSON.

This makes the LLM a callable step inside deterministic automation. For example, a Kiro-generated script can search files, read selected excerpts, call `fabric.ai.run()` for analysis, validate the answer, call `fabric.ai.parallel()` for independent follow-up tasks, and return one final structured result. The workflow is code, so it can be reviewed, tested, repeated, and composed with ordinary development logic.

Under the hood, Kiro Fabric type-checks each script before execution, enforces filesystem and shell permissions, applies AI call and size limits, can run independent AI tasks concurrently, validates responses against JSON Schema, records run metrics, and optionally caches deterministic calls.

> Kiro Fabric is not a separate LLM model. It orchestrates the model configured in Kiro CLI.

## Features and benefits

| Feature | Benefit |
| --- | --- |
| Checked TypeScript programs | Repeatable workflows that are validated before they run |
| Bounded search and file reads | Less prompt noise and more token-efficient context |
| JSON Schema validation | More predictable output, with one optional repair attempt |
| Call, size, concurrency, and time limits | Controlled resource use and faster parallel analysis |
| Project-contained tools and permissions | Safer access to files, Git, shell, and inspections |
| Local run records | Easier debugging with programs, diagnostics, metrics, and results |

Token savings depend on the task and model. Kiro Fabric limits calls and characters; it does not measure or promise a fixed number of provider tokens.

## Requirements

- [Git](https://git-scm.com/)
- Node.js 20 or newer
- [pnpm](https://pnpm.io/)
- [Kiro CLI](https://kiro.dev/docs/cli/) available as `kiro-cli` and signed in (`kiro-cli login`)

## Install

```bash
git clone https://github.com/asx8678/kiro-fabric.git
cd kiro-fabric
pnpm run setup:kiro
```

Setup installs dependencies, builds Kiro Fabric, creates the Kiro agents, prompts, and `.fabric-lite/config.json`, then runs a health check.

```bash
# Preview generated agent, prompt, and configuration files
pnpm run setup:kiro --dry-run

# Back up and replace conflicting generated files
pnpm run setup:kiro --force
```

A dry run still installs dependencies and rebuilds `dist/`; it only avoids writing generated Kiro and configuration files.

## Use the app

In the configured repository, run:

```bash
kiro-cli --agent fabric-lite
```

Then ask a normal question, such as:

```text
Find the cause of the failing tests and suggest a fix.
```

To configure another repository, run this from the Kiro Fabric clone:

```bash
node dist/cli/main.js install-kiro --cwd /path/to/your/project
cd /path/to/your/project
kiro-cli --agent fabric-lite
```

From the Kiro Fabric clone, check a configured project with:

```bash
node dist/cli/main.js doctor --cwd /path/to/your/project --format json
```

### Text output

The CLI defaults to readable text output for `check`, `run`, and `exec`, styled with a gold accent: a branded run header, numbered source between `─ program` and `─ result` (or red `─ error`) rules, diagnostics with carets, and live interaction on stderr — a run-start line plus one line per AI call (`›` ok, `↻` repair, `✗` failed). Retried calls are also summarized in the header. Add `// @name: My program` (and optionally `// @description: ...`) near the top of a program to label its run header. JSON output remains available with `--format json`. Set `FABRIC_LITE_HIGHLIGHT=1` (also `true`, `yes`, or `on`) to enable simple source highlighting. Colors follow the usual conventions: shown only on a TTY and disabled via `NO_COLOR`.

## How it works

LLM calls, project tools, and response schemas are optional. A program uses only what its task needs.

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Kiro as Kiro CLI
    participant Fabric as Kiro Fabric (local)
    participant LLM as Kiro LLM

    You->>Kiro: Ask a question
    Kiro->>Fabric: Submit a TypeScript program
    Fabric->>Fabric: Type-check it and apply limits

    opt The program requests project tools
        Fabric->>Fabric: Check each operation and gather context
    end

    opt The program requests LLM reasoning
        Fabric->>LLM: Send focused instructions and selected context
        LLM-->>Fabric: Return structured JSON
        Fabric->>Fabric: Parse JSON and validate a schema if supplied
    end

    Fabric-->>Kiro: Return the program result
    Kiro-->>You: Show the final answer
```

Defaults allow up to 7 AI calls with concurrency up to 3. Change limits and permissions in `.fabric-lite/config.json`.

## Safe mutation workflow

Writes remain disabled unless `.fabric-lite/config.json` sets `mutation.enabled` and `filesystem.allowWrite`. Configure `mutation.require` as `clean` (default) or `checkpoint`, and bound review diffs with `mutation.maxDiffChars` (default `30000`). A checkpoint snapshots the dirty tracked worktree with a temporary Git index; ignored files are not included and the real index and branch are unchanged.

```ts
const session = await fabric.mutate.begin({ mode: "checkpoint", label: "update config" });
await fabric.fs.write({ path: "src/config.ts", content: "export const enabled = true;\n" });
const diff = await fabric.mutate.diff();
const review = await fabric.mutate.review();
if (review.value?.approved) return await fabric.mutate.complete();
return await fabric.mutate.rollback();
```

After `complete()`, use its rollback guidance. In checkpoint mode it includes `git restore --source=<checkpoint> --worktree -- .`, manual deletion of created files, and `git update-ref -d refs/fabric-lite/checkpoints/<unique-id>`.

## AI call caching

Caching is disabled by default. Enable it for deterministic requests with bounded entries and optional expiry:

```json
{
  "cache": { "enabled": true, "maxEntries": 200, "ttlMs": 3600000 }
}
```

Keys include the redacted request context, instruction, role, schema, model, limits, and runner configuration. Cache hits do not consume AI budgets; entries live in `.fabric-lite/cache/`.

## Programmatic LLM usage

**Programmatic LLM usage** means calling an LLM from code. The code chooses the context, number of calls, and required output structure.

Save this as `example.ts`:

```ts
const paths = await fabric.fs.glob({
  pattern: "src/**/*.ts",
  maxResults: 5,
});

const files = await fabric.fs.readMany({
  paths,
  maxFiles: 5,
  maxCharsPerFile: 3000,
  maxTotalChars: 12000,
});

const answer = await fabric.ai.run({
  instruction: "Using only these excerpts, briefly describe the project.",
  context: files.map(({ path, content }) => ({ path, content })),
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false,
  },
});

return answer.value;
```

Run it with:

```bash
node dist/cli/main.js run --file example.ts --format json
```

Programs are TypeScript function bodies with top-level `await` and `return`; `import` and `require` are not allowed.

## Security and privacy

- Selected context is sent to the Kiro LLM. Secret filtering helps, but it is not complete data-loss prevention.
- Reads are allowed by default; writes, local commits, and generic shell are disabled by default.
- Commands classified as destructive are denied. If you enable generic shell, approved commands are still powerful.
- Headless runs deny actions with an `ask` policy. In interactive mode, **Allow session** approves the whole category until the process exits.
- `.fabric-lite/runs/` is persistent and may contain sensitive data. The installer adds it to `.gitignore`; verify this in every project.
- Kiro Fabric runs trusted local programs and is not a sandbox for hostile JavaScript.

See [security details](docs/SECURITY.md).

## Troubleshooting

- **Kiro unavailable:** run `kiro-cli --version`, then `kiro-cli login`.
- **Missing or changed agents/prompts:** run `node dist/cli/main.js doctor --format json`, then rerun setup.
- **Setup conflict:** review the file, then use `pnpm run setup:kiro --force`; backups are created first.
- **Changes not visible:** restart Kiro after reinstalling.
- **Real LLM health check:** run `node dist/cli/main.js doctor --smoke`; this makes a real call and may use paid quota.

## Uninstall

There is no automatic uninstall command. In each configured repository, first remove only prompts listed in its installer manifest:

```bash
node --input-type=module <<'NODE'
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const directory = ".kiro/prompts";
const manifestPath = path.join(directory, ".fabric-lite-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const names = Object.keys(manifest.files ?? {});

for (const name of names) {
  const safe = name === path.posix.basename(name) && name === path.win32.basename(name);
  if (!safe || name === ".fabric-lite-manifest.json") throw new Error(`Unsafe entry: ${name}`);
  await rm(path.join(directory, name), { force: true });
}
await rm(manifestPath, { force: true });
NODE
```

Then remove project files and, once, the global agents:

```bash
rm -rf .fabric-lite
rm -f .kiro/agents/fabric-lite.json .kiro/agents/fabric-lite-worker.json
rm -f ~/.kiro/agents/fabric-lite.json ~/.kiro/agents/fabric-lite-worker.json
```

Unrelated prompts and backups are left untouched. You may also remove the two `.fabric-lite/` lines added to `.gitignore` and delete the source clone.

## More help

```bash
node dist/cli/main.js docs
```

See [`examples/`](examples/) and the detailed [Kiro setup guide](docs/KIRO_SETUP.md).