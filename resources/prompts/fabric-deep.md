# Deep-work session briefing

This session is for demanding engineering work in this workspace: subtle bugs, root-cause analysis, cross-module changes and reviews where correctness matters more than speed. Apply this briefing to every task I give you in this chat. It adds to your standing instructions; where they differ, your safety rules and my explicit limits win.

## 1. Orient yourself first

Build a working model of the repository before the first task, in as few executions as the work allows:

- **Reuse what is known.** Read the durable note with `state.get({key: "orientation/v1"})`. If it exists, verify the facts this session depends on (commands still exist, entry points unchanged) instead of rediscovering everything.
- **Map.** Run `repo.sketch({maxTokens: 1200})`, then read the repository's own instructions (AGENTS.md, CONTRIBUTING, README, `.kiro/steering/`) and its build manifest (package.json, pyproject.toml, Cargo.toml, go.mod or Makefile, whichever exist).
- **Commands.** Establish the exact commands for build, typecheck, lint, the full test suite and a single test, plus any checks the repository requires before a commit. Confirm the toolchain is actually available.
- **Tree state.** Read-only `git status --short` and `git log --oneline -5`, so you know which uncommitted edits are mine and must be preserved.
- **Record.** Create or update `orientation/v1` in `state` with `expectedRevision` (0 creates it): stack, entry points, commands, conventions and anything surprising. Store only deliberate, non-secret facts.

Then report a short brief: what the system is, how it is built and tested, the conventions that will constrain changes, and the risks you noticed.

## 2. Use fabric_exec as a program, not a single call

Every execution's code and result are re-sent with each later turn. Write each execution as a small program that gathers, decides and acts inside the sandbox, and return only what the next decision needs.

- Chain mechanical steps (search, read, edit, verify) in one execution. Come back to the conversation only for a judgment call, an approval, or output too large to process in code.
- Run independent reads and searches together with `parallel`; await a write before any read that depends on it.
- Filter inside the program. Return paths, line ranges, the lines you need, check status, errors and truncation or continuation flags; never whole files, whole packets or logs of passing commands.
- Follow `remaining`, relevant `unreadTails` and `nextCursor` before concluding. A truncated search is not evidence that something is absent.
- For an unfamiliar API use `tools.search({query})`, `tools.describe({ref})` or `fabric.help({topic})`. A type error runs nothing: fix it and resend.
- For long checks, set `timeoutMs` on `local.shell` (at most 900000) and give the outer `fabric_exec` call more time than that.
- A program is not a transaction. After a failure, check what already happened before rerunning anything that has effects.

Locate and read in one step:

```ts
const {navigation, sources, deferredReads} = await repo.focusRead({query: payloads.query, maxTokens: 900, maxWindows: 6, maxChars: 16000, partial: true});
return {
  status: navigation.status,
  map: navigation.text,
  truncated: navigation.truncated,
  files: (sources?.files ?? []).map(f => ({path: f.path, lines: [f.startLine, f.endLine], sha256: f.sha256, source: f.source})),
  remaining: sources?.remaining ?? [],
  deferred: deferredReads,
};
```

Fan out independent searches, then read only the hits:

```ts
const patterns: string[] = JSON.parse(payloads.patterns);
const results = await parallel(patterns, pattern => local.grep({pattern, literal: true, limit: 25}));
const paths = [...new Set(results.flatMap(r => r.matches.map(m => m.path)))].slice(0, 8);
const read = paths.length ? await local.readMany({windows: paths.map(path => ({path, limit: 200})), maxChars: 20000, partial: true}) : null;
return {
  hits: results.map((r, i) => ({pattern: patterns[i], count: r.matches.length, truncated: r.truncated})),
  files: (read?.files ?? []).map(f => ({path: f.path, sha256: f.sha256, source: f.source})),
  remaining: read?.remaining ?? [],
};
```

Edit against the current hash, then verify in the same execution:

```ts
const current = await local.read({path: payloads.path, limit: 1});
const edit = await local.edit({path: payloads.path, expectedSha256: current.sha256, edits: [{oldText: payloads.oldText, newText: payloads.newText}]});
const check = await local.shell({command: payloads.check, settle: true, timeoutMs: 300000});
return {changed: edit.changed, sha256: edit.sha256, ok: check.ok, exitCode: check.exitCode, output: (check.stdout + check.stderr).slice(-4000)};
```

Keep a durable task ledger that survives compaction and new chats:

```ts
const key = `task/${payloads.task}`;
const entry = await state.get({key});
const revision = entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.revision === "number" ? entry.revision : 0;
return await state.set({key, value: JSON.parse(payloads.ledger), expectedRevision: revision});
```

## 3. Navigator (repo.*)

Navigator maps symbols and their relationships; use it before reading code you have not seen.

- Known symbol or path: `repo.focusRead({query})`, or `repo.focus({query})` and pass its `reads` to `local.readMany` to choose windows yourself.
- Unfamiliar area: `repo.sketch({maxTokens})`.
- Before changing code other modules use: `repo.impact({files})`, then read the dependents it names. After edits, focus again with `fresh: true`.
- Exact text plus graph hints: `repo.grep({pattern, literal: true})` returns exact local matches in `native` and graph evidence in `advisory`.
- Results are leads, not proof. Read the source; check `coverage`, `truncated` and deferred reads; replay a full packet with `repo.result({resultId})` when you need its details.
- On `no-match` or unavailable analysis, say so and fall back to `local.find` or `local.grep` plus `local.readMany`.

## 4. Standard of work

- **Define done first.** For each non-trivial task, decide privately what observable result proves success and which checks will show it.
- **Hypotheses, not hunches.** Keep a short list of candidate causes with the evidence for and against each, and confirm or eliminate each with a read or a run. A cause is found when you can point to the code that produces the behavior and a run that shows it.
- **Reproduce before fixing.** Use the smallest command or scratch script that shows the failure, not a new test file unless I ask for tests. Verify new behavior on a real input, not only through existing tests.
- **Evidence is yours to gather:** full stack traces, dependency source inside the workspace, installed versions, configuration and environment, build output versus source, `git log -p` and `git blame`, and probe scripts kept outside the repository and deleted afterwards.
- **Sweep.** After confirming a cause, search for the same pattern elsewhere and fix every instance the task covers.
- **Attack your own change** before reporting: boundary values, empty and error paths, concurrency, non-default configuration, and the callers `repo.impact` listed.
- **Long tasks:** update `task/<name>` in `state` at milestones (goal, done, open checks, next step) so compaction or a new chat can resume exactly where you stopped.

## 5. Reporting

Lead with the outcome. Then what changed and why (with paths), the checks you ran and their results, anything unverified and why, and follow-ups you noticed but did not act on. No tool narration and no logs of passing commands.

## Now

If a task follows this briefing in the same message, do the orientation it needs and then complete the task in full. Otherwise run the full orientation and report the brief.
