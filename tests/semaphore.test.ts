import { describe, it, expect, vi } from "vitest";
import { Semaphore } from "../src/agents/semaphore.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Semaphore lane fairness", () => {
  it("never grants more than the global limit across lanes", async () => {
    const sem = new Semaphore(2);
    const grants: number[] = [];
    const release = await sem.acquire();
    const release2 = await sem.acquire();
    expect(typeof release).toBe("function");
    expect(typeof release2).toBe("function");
    let granted = 0;
    const p = (async () => {
      const r = await sem.acquire(undefined, "a");
      granted++;
      r();
    })();
    await sleep(5);
    expect(granted).toBe(0);
    release();
    await p;
    expect(granted).toBe(1);
  });

  it("round-robins between lanes (A1, B1, A2) with limit 1", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const hold = await sem.acquire();
    const launch = (name: string, lane: string) =>
      sem.acquire(undefined, lane).then((release) => {
        order.push(name);
        release();
      });
    const a1 = launch("A1", "a");
    await sleep(1);
    const a2 = launch("A2", "a");
    await sleep(1);
    const b1 = launch("B1", "b");
    await sleep(1);
    hold();
    await Promise.all([a1, a2, b1]);
    expect(order).toEqual(["A1", "B1", "A2"]);
  });

  it("keeps default-lane strict FIFO when only one lane is used", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const hold = await sem.acquire();
    const launch = (name: string) =>
      sem.acquire().then((release) => {
        order.push(name);
        release();
      });
    const [x, y, z] = [launch("1"), launch("2"), launch("3")];
    await sleep(5);
    hold();
    await Promise.all([x, y, z]);
    expect(order).toEqual(["1", "2", "3"]);
  });

  it("rejects an aborted queued waiter without consuming capacity", async () => {
    const sem = new Semaphore(1);
    const hold = await sem.acquire();
    const controller = new AbortController();
    const waiting = sem.acquire(controller.signal, "x");
    await sleep(1);
    controller.abort();
    await expect(waiting).rejects.toThrow("Operation aborted");
    // Capacity remains usable after the holder releases.
    const pending = sem.acquire(undefined, "y");
    hold();
    const next = await pending;
    expect(next).toBeTypeOf("function");
    next();
  });

  it("releases exactly once (idempotent release closure)", async () => {
    const sem = new Semaphore(1);
    const seen: string[] = [];
    const hold = await sem.acquire();
    const later = sem.acquire(undefined, "z").then((release) => {
      seen.push("granted");
      release();
      release();
    });
    await sleep(1);
    hold();
    await later;
    expect(seen).toEqual(["granted"]);
    // After both released, a new acquire completes immediately (capacity back to 1).
    const r = await sem.acquire();
    expect(r).toBeTypeOf("function");
    r();
  });
});