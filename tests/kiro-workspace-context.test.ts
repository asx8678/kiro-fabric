import { describe, expect, it, vi } from "vitest";
import {
  CachedWorkspaceContextProvider,
  type KiroWorkspaceRoot,
} from "../src/kiro/power/workspace-context.js";

describe("CachedWorkspaceContextProvider", () => {
  it("caches verified snapshots until invalidated or expired", async () => {
    let now = 1_000;
    const roots: KiroWorkspaceRoot[] = [{ uri: "file:///workspace", name: "workspace" }];
    const load = vi.fn(async () => roots);
    const provider = new CachedWorkspaceContextProvider(
      { supported: () => true, load },
      { ttlMs: 100, now: () => now },
    );

    expect(await provider.current()).toMatchObject({ status: "verified", roots });
    await provider.current();
    expect(load).toHaveBeenCalledTimes(1);

    provider.invalidate();
    expect((await provider.current()).revision).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);

    now += 101;
    await provider.current();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not lose an invalidation that arrives during an in-flight refresh", async () => {
    let release!: (roots: readonly KiroWorkspaceRoot[]) => void;
    const first = new Promise<readonly KiroWorkspaceRoot[]>((resolve) => { release = resolve; });
    const load = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce([{ uri: "file:///new-workspace" }]);
    const provider = new CachedWorkspaceContextProvider({ supported: () => true, load });

    const oldRefresh = provider.current();
    provider.invalidate();
    const forcedRefresh = provider.current({ force: true });
    release([{ uri: "file:///old-workspace" }]);

    await expect(oldRefresh).resolves.toMatchObject({ roots: [{ uri: "file:///old-workspace" }] });
    await expect(forcedRefresh).resolves.toMatchObject({
      revision: 2,
      roots: [{ uri: "file:///new-workspace" }],
    });
    expect(load).toHaveBeenCalledTimes(2);
    await provider.current();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("distinguishes explicit empty roots from transient failure", async () => {
    let fail = false;
    let roots: KiroWorkspaceRoot[] = [{ uri: "file:///workspace" }];
    const provider = new CachedWorkspaceContextProvider({
      supported: () => true,
      load: async () => {
        if (fail) throw new Error("temporary timeout");
        return roots;
      },
    });

    await expect(provider.current()).resolves.toMatchObject({ status: "verified", roots });
    fail = true;
    provider.invalidate();
    await expect(provider.current()).resolves.toMatchObject({
      status: "temporarily-unavailable",
      roots,
      error: "temporary timeout",
    });

    fail = false;
    roots = [];
    provider.invalidate();
    await expect(provider.current()).resolves.toMatchObject({
      status: "explicitly-empty",
      roots: [],
    });
  });

  it("treats an unsupported roots capability as explicitly empty", async () => {
    const load = vi.fn(async () => [{ uri: "file:///unexpected" }]);
    const provider = new CachedWorkspaceContextProvider({ supported: () => false, load });
    await expect(provider.current()).resolves.toMatchObject({
      status: "explicitly-empty",
      roots: [],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("publishes each observed snapshot without allowing listener failures to break refresh", async () => {
    const provider = new CachedWorkspaceContextProvider({
      supported: () => true,
      load: async () => [{ uri: "file:///workspace" }],
    });
    const observed: string[] = [];
    provider.subscribe((snapshot) => observed.push(snapshot.status));
    provider.subscribe(() => { throw new Error("observer failure"); });
    await provider.current();
    expect(observed).toEqual(["verified"]);
  });
});
