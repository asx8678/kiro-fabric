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

Run the following in one `fabric_exec` call:

```ts
type WorkOutcome =
  | { item: string; status: "completed"; result: string; value?: unknown }
  | { item: string; status: "failed"; error: string };

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

const completed = outcomes.filter(
  (outcome): outcome is Extract<WorkOutcome, { status: "completed" }> =>
    outcome.status === "completed",
);
const failures = outcomes.filter(
  (outcome): outcome is Extract<WorkOutcome, { status: "failed" }> =>
    outcome.status === "failed",
);
return {
  status: completed.length === 0 ? "failed" : failures.length === 0 ? "success" : "partial",
  coverage: { requested: items.length, completed: completed.length },
  completed,
  failures,
};
```

The parent remains responsible for reconciling overlapping claims and running
the final repository-wide oracle. Partial results are usable: retry only failed
items when their coverage matters. Never trigger an automatic whole-workflow
rerun, and never rerun a successful partition.
