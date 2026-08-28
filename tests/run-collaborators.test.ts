import { describe, expect, it } from "vitest";
import { RunStore } from "../src/agents/run-store.js";
import { RunPresenter } from "../src/agents/run-presenter.js";
import { RunReconciler } from "../src/agents/run-reconciler.js";

describe("agent run collaborators", () => {
  it("keeps RunStore insertion order and exact lookup errors", () => {
    const store = new RunStore<{ id: string }>();
    store.set({ id: "a" }); store.set({ id: "b" });
    expect([...store.keys()]).toEqual(["a", "b"]);
    expect(store.require("b").id).toBe("b");
    expect(() => store.require("missing")).toThrow("Unknown Fabric agent: missing");
  });

  it("isolates and invalidates bounded presenter projections", () => {
    const presenter = new RunPresenter<{ value: string }>((record) => ({ value: record.value.slice(0, 3) }));
    const projected = presenter.list([{ value: "abcdef" }]);
    projected[0]!.value = "mutated";
    expect(presenter.list([{ value: "abcdef" }])[0]!.value).toBe("abc");
    presenter.invalidate();
    expect(presenter.project({ value: "abcdef" }).value).toBe("abc");
  });

  it("owns listener notifications and preserves the manager list identity", () => {
    const presenter = new RunPresenter<{ value: string }>((record) => ({ value: record.value }));
    const notifications: number[] = [];
    const unsubscribe = presenter.subscribe(() => notifications.push(1));
    const first = presenter.cachedList(() => [{ value: "a" }]);
    expect(presenter.cachedList(() => [{ value: "b" }])).toBe(first);
    presenter.invalidate();
    expect(notifications).toEqual([1]);
    const second = presenter.cachedList(() => [{ value: "b" }]);
    expect(second).not.toBe(first);
    unsubscribe();
    presenter.invalidate();
    expect(notifications).toEqual([1]);
  });

  it("provides safe insertion-order snapshots and batch deletion", () => {
    const store = new RunStore<{ id: string }>();
    store.set({ id: "a" });
    store.set({ id: "b" });
    store.set({ id: "c" });
    expect(store.keysArray()).toEqual(["a", "b", "c"]);
    expect(store.deleteMany(["b", "missing"])).toEqual([{ id: "b" }]);
    expect(store.valuesArray().map((run) => run.id)).toEqual(["a", "c"]);
  });

  it("commits settlement once per run", () => {
    const reconciler = new RunReconciler<number>();
    const values: number[] = [];
    expect(reconciler.settleOnce("a", 1, (value) => values.push(value))).toBe(true);
    expect(reconciler.settleOnce("a", 2, (value) => values.push(value))).toBe(false);
    expect(reconciler.settleOnce("b", 3, (value) => values.push(value))).toBe(true);
    expect(values).toEqual([1, 3]);
  });

  it("centralizes bounded transport-exit polling", async () => {
    const reconciler = new RunReconciler<void>();
    let aliveChecks = 0;
    await reconciler.waitForTransportExit(async () => {
      aliveChecks++;
      return aliveChecks < 2;
    }, 1, 100);
    expect(aliveChecks).toBe(2);
  });
});
