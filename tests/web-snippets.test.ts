import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { webOpenSnippet, webSearchSnippet } from "../src/providers/web-snippets.js";

function browser(options: { fail?: string; delayedCreate?: boolean; delayedContext?: boolean; blocked?: boolean } = {}) {
  const events: string[] = [], closed: string[] = [], timers: ReturnType<typeof setTimeout>[] = [];
  let next = 0, nextContext = 0;
  const contexts = new Set<string>(), disposed: string[] = [];
  const sessions = new Map<string, string>(), locations = new Map<string, string>();
  const document = {
    title: "Primary source", body: { innerText: " fallback content " },
    querySelector(selector: string): unknown {
      if (selector.includes("captcha")) return options.blocked ? {} : null;
      if (selector === "[") throw new Error("invalid selector");
      return selector === "main" ? { innerText: " article evidence " } : null;
    },
    querySelectorAll: () => [
      ...["https://example.com/primary", "javascript:evil()", "https://example.com/primary", "https://example.org/other"].map(href => ({
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
        if (options.delayedContext) await new Promise(resolve => setTimeout(resolve, 40));
        const browserContextId = `c${++nextContext}`; contexts.add(browserContextId); return { browserContextId };
      },
      disposeBrowserContext: async ({ browserContextId }: { browserContextId: string }) => { disposed.push(browserContextId); contexts.delete(browserContextId); },
      createTarget: async (args: { background: boolean; browserContextId: string }) => {
        expect(args.background).toBe(true);
        expect(contexts.has(args.browserContextId)).toBe(true);
        if (options.delayedCreate) await new Promise(resolve => setTimeout(resolve, 40));
        return { targetId: `t${++next}` };
      },
      attachToTarget: async ({ targetId }: { targetId: string }) => {
        if (options.fail === "attach") throw new Error("attach failure");
        const sessionId = "s" + targetId; sessions.set(sessionId, targetId); return { sessionId };
      },
    },
    closeTab: async (target: string) => { closed.push(target); },
    waitFor: ({ sessionId }: { sessionId: string }) => { events.push(sessionId + ":wait"); return Promise.resolve(); },
    use: () => { throw new Error("must not change active tab"); },
  };
  const cdp = async (sid: string, method: string, args: { url?: string; expression?: string }) => {
    expect(sessions.has(sid)).toBe(true); events.push(sid + ":" + method);
    if (method === "Page.navigate") { locations.set(sid, args.url!); return options.fail === "navigate" ? { errorText: "net::ERR_FAILED" } : {}; }
    if (method !== "Runtime.evaluate") return {};
    if (options.fail === "evaluate") return { exceptionDetails: { text: "evaluation failure" } };
    try {
      const result = vm.runInNewContext(args.expression!, { document, location: new URL(locations.get(sid)!), URL }, { timeout: 100 });
      return { result: { value: result } };
    } catch (error) { return { exceptionDetails: { text: String(error) } }; }
  };
  const run = (code: string) => vm.runInNewContext(`(async () => { ${code} })()`, { session, cdp, setTimeout: (fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); timers.push(timer); return timer; }, clearTimeout }, { timeout: 100 }) as Promise<unknown>;
  return { run, events, closed, timers, disposed };
}

describe("actual browser snippets against a deterministic CDP/DOM fixture", () => {
  it("extracts and deduplicates http(s) sources and preserves hostile query text as data", async () => {
    const b = browser(), query = '\"; process.exit(1); // ` ${evil}';
    expect(await b.run(webSearchSnippet(query, 5, 1000))).toEqual({ source: "google", query, results: [
      { title: "Primary source", url: "https://example.com/primary", snippet: "Source snippet" },
      { title: "Primary source", url: "https://example.org/other", snippet: "Source snippet" },
    ] });
    expect(b.closed).toEqual(["t1"]);
    expect(b.events.indexOf("st1:wait")).toBeLessThan(b.events.indexOf("st1:Page.navigate"));
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
    await expect(browser({ blocked: true }).run(webSearchSnippet("facts", 5, 1000))).rejects.toThrow("consent or CAPTCHA");
    await expect(browser().run(webOpenSnippet("https://example.com", "[", "load", 0, 100, 1000))).rejects.toThrow("invalid selector");
  });
  it("cleans up a tab whose creation completes after the per-page deadline without navigating", async () => {
    const b = browser({ delayedCreate: true });
    await expect(b.run(webSearchSnippet("facts", 5, 10))).rejects.toThrow("timed out");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(b.closed).toEqual(["t1"]); expect(b.events).toEqual([]);
  });
});
