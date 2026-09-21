import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webOpenSnippet, webSearchSnippet } from "../src/providers/web-snippets.js";

afterEach(() => { vi.useRealTimers(); });

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function browser(options: {
  fail?: string; delayedCreate?: boolean; delayedContext?: boolean; blocked?: boolean;
  context?: () => Promise<void>; target?: () => Promise<void>;
  close?: () => Promise<void>; dispose?: () => Promise<void>;
  ready?: () => Promise<void>; navigate?: () => Promise<void>;
  pageUrl?: string; links?: string[]; consent?: boolean;
} = {}) {
  const events: string[] = [], closed: string[] = [], timers: ReturnType<typeof setTimeout>[] = [];
  let next = 0, nextContext = 0;
  const contexts = new Set<string>(), disposed: string[] = [];
  const sessions = new Map<string, string>(), locations = new Map<string, string>();
  const document = {
    title: "Primary source", body: { innerText: " fallback content " },
    querySelector(selector: string): unknown {
      if (selector.includes("captcha")) return options.blocked ? {} : null;
      if (selector.includes("consent.google")) return options.consent ? {} : null;
      if (selector === "[") throw new Error("invalid selector");
      return selector === "main" ? { innerText: " article evidence " } : null;
    },
    querySelectorAll: () => [
      ...(options.links ?? ["https://example.com/primary", "javascript:evil()", "https://example.com/primary", "https://example.org/other"]).map(href => ({
        href,
        textContent: " Primary source ", closest: (selector: string) => selector === "a[href]" ? { href } : { querySelector: () => ({ textContent: " Source snippet " }) },
      })),
    ],
  };
  const session = {
    isConnected: () => true,
    Target: {
      createBrowserContext: async (args: { disposeOnDetach: boolean }) => {
        expect(args.disposeOnDetach).toBe(true);
        if (options.fail === "context") throw new Error("private contexts unsupported");
        if (options.fail === "invalid-context") return { browserContextId: "" };
        if (options.context) await options.context();
        if (options.delayedContext) await new Promise(resolve => setTimeout(resolve, 40));
        const browserContextId = `c${++nextContext}`; contexts.add(browserContextId); return { browserContextId };
      },
      disposeBrowserContext: async ({ browserContextId }: { browserContextId: string }) => {
        disposed.push(browserContextId);
        if (options.dispose) await options.dispose();
        contexts.delete(browserContextId);
      },
      createTarget: async (args: { background: boolean; browserContextId: string }) => {
        expect(args.background).toBe(true);
        expect(contexts.has(args.browserContextId)).toBe(true);
        if (options.target) await options.target();
        if (options.delayedCreate) await new Promise(resolve => setTimeout(resolve, 40));
        return { targetId: `t${++next}` };
      },
      attachToTarget: async ({ targetId }: { targetId: string }) => {
        if (options.fail === "attach") throw new Error("attach failure");
        const sessionId = "s" + targetId; sessions.set(sessionId, targetId); return { sessionId };
      },
    },
    closeTab: (target: string) => { closed.push(target); return options.close?.() ?? Promise.resolve(); },
    waitFor: ({ sessionId }: { sessionId: string }) => { events.push(sessionId + ":wait"); return options.ready?.() ?? Promise.resolve(); },
    use: () => { throw new Error("must not change active tab"); },
  };
  const cdp = async (sid: string, method: string, args: { url?: string; expression?: string }) => {
    expect(sessions.has(sid)).toBe(true); events.push(sid + ":" + method);
    if (method === "Page.navigate") {
      if (options.navigate) await options.navigate();
      locations.set(sid, options.pageUrl ?? args.url!); return options.fail === "navigate" ? { errorText: "net::ERR_FAILED" } : {};
    }
    if (method !== "Runtime.evaluate") return {};
    if (options.fail === "evaluate") return { exceptionDetails: { text: "evaluation failure" } };
    try {
      const result = vm.runInNewContext(args.expression!, { document, location: new URL(locations.get(sid)!), URL, atob }, { timeout: 100 });
      return { result: { value: result } };
    } catch (error) { return { exceptionDetails: { text: String(error) } }; }
  };
  const run = (code: string) => vm.runInNewContext(`(async () => { ${code} })()`, { session, cdp, setTimeout: (fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); timers.push(timer); return timer; }, clearTimeout }, { timeout: 100 }) as Promise<unknown>;
  return { run, events, closed, timers, disposed };
}

describe("actual browser snippets against a deterministic CDP/DOM fixture", () => {
  it("accepts confirmed private-context disposal when concurrent tab closure rejects", async () => {
    const b = browser({ close: () => { throw new Error("PRIVATE_DAEMON_SENTINEL"); } });
    await expect(b.run(webSearchSnippet("facts", 5, 300))).resolves.toMatchObject({ source: "google" });
    expect(b.closed).toEqual(["t1"]); expect(b.disposed).toEqual(["c1"]);
  });
  it("still rejects unconfirmed context disposal even when tab closure succeeds", async () => {
    const b = browser({ dispose: () => { throw new Error("PRIVATE_DAEMON_SENTINEL"); } });
    const error = await b.run(webSearchSnippet("facts", 5, 300)).catch(error => error);
    expect(String(error)).toContain("private context disposal unconfirmed"); expect(String(error)).not.toContain("PRIVATE_DAEMON_SENTINEL");
    expect(b.closed).toEqual(["t1"]); expect(b.disposed).toEqual(["c1"]);
  });
  it.each(["close", "dispose"] as const)("bounds hung %s independently and preserves the original page failure", async operation => {
    vi.useFakeTimers();
    const b = browser({ fail: "evaluate", [operation]: () => new Promise(() => {}) });
    let settled = false;
    const outcome = b.run(webSearchSnippet("facts", 5, 300)).catch(error => { settled = true; return String(error); });
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    expect(b.disposed).toEqual(["c1"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toContain(operation === "dispose" ? "evaluation failure; Web cleanup uncertain:" : "evaluation failure");
    if (operation === "close") expect(await outcome).not.toContain("cleanup uncertain");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([750, 29_000])("awaits slow cleanup with proportional, capped grace for page budget %i", async budget => {
    vi.useFakeTimers();
    const disposal = deferred(), close = deferred();
    const b = browser({ dispose: () => disposal.promise, close: () => close.promise });
    let settled = false;
    const outcome = b.run(webSearchSnippet("facts", 5, budget)).then(value => { settled = true; return value; });
    const grace = Math.min(1000, Math.floor(budget / 3));
    await vi.advanceTimersByTimeAsync(grace - 1);
    expect(settled).toBe(false);
    close.resolve(); disposal.resolve();
    await expect(outcome).resolves.toMatchObject({ source: "google" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([750, 29_000])("limits hung disposal to reserved headroom for page budget %i", async budget => {
    vi.useFakeTimers();
    const b = browser({ dispose: () => new Promise(() => {}) });
    let settled = false;
    const outcome = b.run(webSearchSnippet("facts", 5, budget)).catch(error => { settled = true; return String(error); });
    const grace = Math.min(1000, Math.floor(budget / 3));
    await vi.advanceTimersByTimeAsync(grace - 1); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toContain("private context disposal unconfirmed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["context", "target"] as const)("cleans late %s creation after grace even when cleanup rejects", async operation => {
    vi.useFakeTimers();
    const creation = deferred();
    const b = browser({ [operation]: () => creation.promise, close: async () => { throw new Error("private close"); }, dispose: async () => { throw new Error("private disposal"); } });
    const outcome = b.run(webSearchSnippet("facts", 5, 30)).catch(error => String(error));
    await vi.advanceTimersByTimeAsync(40);
    expect(await outcome).toContain("Web page timed out; Web cleanup uncertain: private resource creation still pending");
    creation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.disposed).toEqual(["c1"]);
    expect(b.closed).toEqual(operation === "target" ? ["t1"] : []);
    expect(b.events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["context", "target"] as const)("awaits %s creation and disposal arriving inside cleanup grace", async operation => {
    vi.useFakeTimers();
    const creation = deferred(), disposal = deferred();
    const b = browser({ [operation]: () => creation.promise, dispose: () => disposal.promise });
    let settled = false;
    const outcome = b.run(webSearchSnippet("facts", 5, 300)).catch(error => { settled = true; return String(error); });
    await vi.advanceTimersByTimeAsync(310);
    creation.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    disposal.resolve();
    expect(await outcome).toBe("Error: Web page timed out");
    expect(b.disposed).toEqual(["c1"]);
    expect(b.closed).toEqual(operation === "target" ? ["t1"] : []);
    expect(b.events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("observes cleanup rejections arriving after the bounded response", async () => {
    vi.useFakeTimers();
    const close = deferred(), disposal = deferred();
    const b = browser({ close: () => close.promise, dispose: () => disposal.promise });
    const outcome = b.run(webSearchSnippet("facts", 5, 300)).catch(error => String(error));
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toContain("tab closure unconfirmed; private context disposal unconfirmed");
    close.reject(new Error("private late close")); disposal.reject(new Error("private late disposal"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("observes navigation and readiness failures after a page timeout", async () => {
    vi.useFakeTimers();
    const ready = deferred(), navigation = deferred();
    const b = browser({ ready: () => ready.promise, navigate: () => navigation.promise });
    const outcome = b.run(webSearchSnippet("facts", 5, 300)).catch(error => String(error));
    await vi.advanceTimersByTimeAsync(300);
    expect(await outcome).toBe("Error: Web page timed out");
    ready.reject(new Error("late ready")); navigation.reject(new Error("late navigation"));
    await vi.advanceTimersByTimeAsync(0);
    expect(b.disposed).toEqual(["c1"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("observes readiness rejection after navigation fails and cleanup completes", async () => {
    vi.useFakeTimers();
    const ready = deferred();
    const b = browser({ fail: "navigate", ready: () => ready.promise });
    await expect(b.run(webSearchSnippet("facts", 5, 300))).rejects.toThrow("Web navigation failed");
    ready.reject(new Error("late readiness failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(b.disposed).toEqual(["c1"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("extracts and deduplicates http(s) sources and preserves hostile query text as data", async () => {
    const b = browser(), query = '\"; process.exit(1); // ` ${evil}';
    expect(await b.run(webSearchSnippet(query, 5, 1000))).toEqual({ source: "google", query, results: [
      { title: "Primary source", url: "https://example.com/primary", snippet: "Source snippet" },
      { title: "Primary source", url: "https://example.org/other", snippet: "Source snippet" },
    ] });
    expect(b.closed).toEqual(["t1"]);
    expect(b.events.indexOf("st1:wait")).toBeLessThan(b.events.indexOf("st1:Page.navigate"));
  });
  it.each(["google", "bing"] as const)("returns safe CAPTCHA categories for %s without fallback or additional navigation", async engine => {
    const b = browser({ blocked: true });
    expect(await b.run(webSearchSnippet("facts", 3, 1000, engine))).toEqual({ fabricWebError: "captcha" });
    expect(b.events.filter(e => e.endsWith(":Page.navigate"))).toHaveLength(1);
    expect(b.closed).toEqual(["t1"]); expect(b.disposed).toEqual(["c1"]);
  });
  it.each([
    ["https://consent.google.com/m", "consent"],
    ["https://www.google.com/sorry/index", "captcha"],
    ["https://example.com/not-google", "unexpected-redirect"],
  ])("classifies %s without returning page content", async (pageUrl, code) => {
    const b = browser({ pageUrl });
    expect(await b.run(webSearchSnippet("facts", 3, 1000))).toEqual({ fabricWebError: code });
    expect(b.disposed).toEqual(["c1"]);
  });
  it("extracts Bing results and unwraps bounded destination URLs without returning tracking redirects", async () => {
    const destination = "https://example.com/caf%C3%A9";
    const tracked = "https://www.bing.com/ck/a?u=a1" + Buffer.from(destination).toString("base64url");
    const b = browser({ links: [tracked, destination, "https://www.bing.com/ck/a?u=a1invalid!", "https://example.org/source", "javascript:evil()"] });
    const result = await b.run(webSearchSnippet("facts", 2, 1000, "bing"));
    expect(result).toEqual({ source: "bing", query: "facts", results: [
      { title: "Primary source", url: destination, snippet: "Source snippet" },
      { title: "Primary source", url: "https://example.org/source", snippet: "Source snippet" },
    ] });
    expect(b.events.filter(e => e.endsWith(":Page.navigate"))).toHaveLength(1);
  });
  it("routes parallel reads to separate tabs, extracts bounded text and falls back to body", async () => {
    const b = browser();
    const results = await Promise.all([
      b.run(webOpenSnippet("https://example.com/a", "main", "almostIdle", 1, 7, 1000)),
      b.run(webOpenSnippet("https://example.com/b", "missing", "load", 0, 100, 1000)),
    ]);
    expect(results[0]).toMatchObject({ finalUrl: "https://example.com/a", text: "article", chars: 16, truncated: true });
    expect(results[1]).toMatchObject({ finalUrl: "https://example.com/b", text: "fallback content", truncated: false });
    expect(b.closed.sort()).toEqual(["t1", "t2"]);
    expect(b.disposed.sort()).toEqual(["c1", "c2"]);
  });
  it.each(["context", "invalid-context"])("fails before creating a tab when private contexts are unavailable: %s", async fail => {
    const b = browser({ fail });
    await expect(b.run(webSearchSnippet("public docs", 5, 1000))).rejects.toThrow();
    expect(b.events).toEqual([]); expect(b.closed).toEqual([]);
  });
  it("disposes a private context created after the deadline without opening a tab", async () => {
    const b = browser({ delayedContext: true });
    await expect(b.run(webSearchSnippet("public docs", 5, 10))).rejects.toThrow("timed out");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(b.disposed).toEqual(["c1"]); expect(b.events).toEqual([]); expect(b.closed).toEqual([]);
  });
  it.each(["attach", "navigate", "evaluate"])("closes the owned tab after %s failures", async fail => {
    const b = browser({ fail });
    await expect(b.run(webOpenSnippet("https://example.com", "main", "load", 0, 100, 1000))).rejects.toThrow();
    expect(b.closed).toEqual(["t1"]);
  });
  it("does not return success for CAPTCHA or invalid CSS", async () => {
    const b = browser({ blocked: true });
    await expect(b.run(webSearchSnippet("facts", 5, 1000))).resolves.toEqual({ fabricWebError: "captcha" });
    expect(b.closed).toEqual(["t1"]); expect(b.disposed).toEqual(["c1"]);
    await expect(browser().run(webOpenSnippet("https://example.com", "[", "load", 0, 100, 1000))).rejects.toThrow("invalid selector");
  });
  it("cleans up a tab whose creation completes after the per-page deadline without navigating", async () => {
    const b = browser({ delayedCreate: true });
    await expect(b.run(webSearchSnippet("facts", 5, 10))).rejects.toThrow("timed out");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(b.closed).toEqual(["t1"]); expect(b.events).toEqual([]);
  });
});
