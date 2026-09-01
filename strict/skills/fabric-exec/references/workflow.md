# Bounded Kiro workflow

Requires a managed profile installed with `--allow-shell --subagents`. Pass the
objective as `strings.task` and one to four non-overlapping work items as a JSON
array in `strings.items`. Assign paths exclusively before execution.

`strings.checks` may contain up to four parent-owned acceptance commands as a
JSON string array. They run once, in order, only after child
fan-out settles. Commands come from this parent input, never from child
text or values. Each has a fixed 120-second timeout; there are no automatic
retries. A nonzero exit, denial, timeout, cancellation, confinement, or spawn
failure fails acceptance closed while preserving every child result.

Run the following in one `fabric_exec` call:

```ts
type WorkOutcome =
  | { item: string; status: "completed"; result: string; value?: unknown }
  | { item: string; status: "failed"; error: string };
type CheckOutcome =
  | { command: string; status: "passed"; output: string }
  | { command: string; status: "failed"; error: string };

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const parseList = (raw: string | undefined, key: "items" | "checks"): string[] => {
  const parsed: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`strings.${key} must be a JSON array of strings`);
  }
  return [...new Set((parsed as string[]).map((value) => value.trim()).filter(Boolean))];
};

const objective = (π.task ?? "").trim();
if (!objective) throw new Error("strings.task must contain the objective");
const items = parseList(π.items, "items");
if (items.length < 1 || items.length > 4) {
  throw new Error("strings.items must contain 1-4 non-empty independent items");
}
const checks = parseList(π.checks, "checks");
if (checks.length > 4) {
  throw new Error("strings.checks must contain at most 4 non-empty parent-owned commands");
}

const outcomes = await parallel(items, async (item, index): Promise<WorkOutcome> => {
  try {
    const result = await agents.run({
      name: `work-${index + 1}`,
      runner: "kiro",
      task: `Complete only this assigned item and verify it with focused checks.\n\nObjective:\n${objective}\n\nAssigned item:\n${item}`,
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
      context: {
        objective,
        facts: [`Assigned partition: ${item}`],
        constraints: ["Do not modify files owned by another partition"],
      },
    });
    return result.status === "completed"
      ? { item, status: "completed", result: result.text, value: result.value }
      : { item, status: "failed", error: result.error ?? result.status };
  } catch (error) {
    return { item, status: "failed", error: errorText(error) };
  }
}, { concurrency: Math.min(4, items.length) });

const checkOutcomes: CheckOutcome[] = [];
for (const command of checks) {
  try {
    const result = await k.bash({ command, timeout: 120 });
    checkOutcomes.push({ command, status: "passed", output: result.output });
  } catch (error) {
    checkOutcomes.push({ command, status: "failed", error: errorText(error) });
  }
}

const completed = outcomes.filter((outcome) => outcome.status === "completed");
const failures = outcomes.filter((outcome) => outcome.status === "failed");
const checkFailures = checkOutcomes.filter((outcome) => outcome.status === "failed");
const childStatus = !completed.length ? "failed" : failures.length ? "partial" : "success";
return {
  status: checkFailures.length ? "failed" : childStatus,
  coverage: { requested: items.length, completed: completed.length },
  completed,
  failures,
  acceptance: {
    requested: checks.length,
    passed: checkOutcomes.length - checkFailures.length,
    results: checkOutcomes,
  },
};
```

The parent reconciles claims and chooses acceptance commands independently of
child output. Partial results remain usable when acceptance fails. Checks run
once and are never retried. Retry only failed items manually when coverage
matters; never trigger an automatic whole-workflow rerun, and never rerun a successful partition.
