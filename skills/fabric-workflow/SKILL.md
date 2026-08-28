---
name: fabric-workflow
description: Runs an explicit bounded workflow across managed Kiro ACP children. Use for a large audit or implementation already partitioned into independent items.
disable-model-invocation: true
---

# Bounded Kiro workflow

This skill requires a managed profile installed with `--allow-shell
--subagents`. Pass the complete objective as `strings.task` and a JSON array of
one to four non-overlapping work items as `strings.items`. Partition file
ownership before execution; concurrent children must not edit the same path.

Optionally pass one to four parent-owned acceptance commands as a JSON string
array in `strings.checks`. They run once, in declaration order, only after child
fan-out settles. The commands come only from this parent input, never from child
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

const objective = (π.task ?? "").trim();
if (!objective) throw new Error("strings.task must contain the objective");
const parsed: unknown = JSON.parse(π.items ?? "[]");
if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
  throw new Error("strings.items must be a JSON array of strings");
}
const items = [...new Set(parsed.map((item) => item.trim()).filter(Boolean))];
if (items.length === 0 || items.length > 4) {
  throw new Error("strings.items must contain 1-4 non-empty independent items");
}
const parsedChecks: unknown = JSON.parse(π.checks ?? "[]");
if (!Array.isArray(parsedChecks) || parsedChecks.some((check) => typeof check !== "string")) {
  throw new Error("strings.checks must be a JSON array of strings");
}
const checks = [...new Set(parsedChecks.map((check) => check.trim()).filter(Boolean))];
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
    if (result.status !== "completed") {
      return { item, status: "failed", error: result.error ?? result.status };
    }
    return { item, status: "completed", result: result.text, value: result.value };
  } catch (error) {
    return {
      item,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}, { concurrency: Math.min(4, items.length) });

const checkOutcomes: CheckOutcome[] = [];
for (const command of checks) {
  try {
    const result = await k.bash({ command, timeout: 120 });
    checkOutcomes.push({ command, status: "passed", output: result.output });
  } catch (error) {
    checkOutcomes.push({
      command,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const completed = outcomes.filter(
  (outcome): outcome is Extract<WorkOutcome, { status: "completed" }> =>
    outcome.status === "completed",
);
const failures = outcomes.filter(
  (outcome): outcome is Extract<WorkOutcome, { status: "failed" }> =>
    outcome.status === "failed",
);
const checkFailures = checkOutcomes.filter(
  (outcome): outcome is Extract<CheckOutcome, { status: "failed" }> =>
    outcome.status === "failed",
);
const childStatus = completed.length === 0 ? "failed" : failures.length === 0 ? "success" : "partial";
return {
  status: checkFailures.length > 0 ? "failed" : childStatus,
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

The parent remains responsible for reconciling overlapping claims and choosing
acceptance commands independently of child output. The bounded checks above are
optional focused or repository-wide oracles. Partial child results remain usable
when acceptance fails: retry neither checks nor successful partitions
automatically. Retry only failed items manually when their coverage matters.
Never trigger an automatic whole-workflow rerun, and never rerun a successful partition.
