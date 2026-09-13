// Fixed host-owned JavaScript for the browser-harness-js REPL. User input is
// JSON-encoded data, never executable code. Every call owns a tab/session ID;
// never use session.use(), which would race the shared active tab.
const pageSnippet = (url: string, expression: string, wait: "networkIdle" | "almostIdle" | "load", settleMs: number, timeoutMs: number): string => `
let targetId, sessionId, browserContextId, expired = false, timer;
let creation, creating = false, tabCleanup, contextCleanup, tabClosed = false, contextDisposed = false;
let result, failure, failed = false;
// pageBudget reserves one quarter of the total budget, i.e. one third
// of this page budget, capped at 1s. Cleanup gets a separate bounded grace.
const cleanupGraceMs = ${Math.max(1, Math.min(1000, Math.floor(timeoutMs / 3)))};
const check = () => { if (expired) throw new Error("Web page deadline expired"); };
const create = (operation) => {
  creating = true;
  creation = Promise.resolve().then(operation).finally(() => { creating = false; });
  return creation;
};
const close = () => {
  // Start both independently: a stuck tab close must not prevent disposal.
  // Observe synchronous throws and rejections; never expose daemon diagnostics.
  if (targetId && !tabCleanup) tabCleanup = Promise.resolve().then(() => session.closeTab(targetId, sessionId))
    .then(() => { tabClosed = true; }, () => {});
  if (browserContextId && !contextCleanup) contextCleanup = Promise.resolve().then(() => session.Target.disposeBrowserContext({ browserContextId }))
    .then(() => { contextDisposed = true; }, () => {});
  return Promise.all([tabCleanup, contextCleanup]);
};
try {
  result = await Promise.race([
    new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("Web page timed out")); }, ${timeoutMs}); }),
    (async () => {
      if (!session.isConnected()) {
        try { await session.connect({ timeoutMs: ${timeoutMs} }); }
        catch (error) { throw new Error("Cannot connect browser-harness-js to Chromium; enable the extension relay or remote debugging: " + error.message); }
      }
      check();
      // Private storage/cookies per call. Unsupported transports must fail;
      // never silently fall back to the user's authenticated default profile.
      const isolated = await create(() => session.Target.createBrowserContext({ disposeOnDetach: true }));
      browserContextId = isolated.browserContextId;
      if (typeof browserContextId !== "string" || !browserContextId) throw new Error("Private browser context unavailable");
      if (expired) { await close(); check(); }
      const target = await create(() => session.Target.createTarget({ url: "about:blank", background: true, browserContextId }));
      targetId = target.targetId;
      if (expired) { await close(); check(); }
      ({ sessionId } = await session.Target.attachToTarget({ targetId, flatten: true }));
      check();
      await cdp(sessionId, "Page.enable", {});
      check();
      await cdp(sessionId, "Page.setLifecycleEventsEnabled", { enabled: true });
      check();
      const wait = ${JSON.stringify(wait)};
      const ready = Promise.resolve().then(() => wait === "load"
        ? session.waitFor({ method: "Page.loadEventFired", sessionId, timeoutMs: ${timeoutMs} })
        : session.waitFor({ method: "Page.lifecycleEvent", sessionId, predicate: (p) => p.name === (wait === "almostIdle" ? "networkAlmostIdle" : "networkIdle"), timeoutMs: ${timeoutMs} }));
      // Observe both promises immediately, including navigation failure. Do not
      // leave a rejected readiness promise unhandled in the shared daemon.
      await Promise.all([ready, Promise.resolve().then(() => cdp(sessionId, "Page.navigate", { url: ${JSON.stringify(url)} })).then((navigation) => {
        if (navigation.errorText) throw new Error("Web navigation failed: " + navigation.errorText);
      })]);
      check();
      ${settleMs ? `await new Promise((resolve) => setTimeout(resolve, ${settleMs})); check();` : ""}
      const evaluated = await cdp(sessionId, "Runtime.evaluate", {
        expression: ${JSON.stringify(expression)}, returnByValue: true,
      });
      check();
      if (evaluated.exceptionDetails) throw new Error("Web page extraction failed: " + (evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text));
      if (typeof evaluated.result?.value !== "string") throw new Error("Web page returned no readable result");
      return JSON.parse(evaluated.result.value);
    })(),
  ]);
} catch (error) {
  failed = true;
  failure = error;
} finally {
  clearTimeout(timer);
}
let cleanupTimer;
try {
  await Promise.race([
    // A creation already in flight may publish an owned ID after timeout.
    // Keep this observer alive after grace expires, without blocking return.
    Promise.all([close(), creation?.then(() => close(), () => close())]),
    new Promise((resolve) => { cleanupTimer = setTimeout(resolve, cleanupGraceMs); }),
  ]);
} finally {
  clearTimeout(cleanupTimer);
}
const uncertainty = [
  creating ? "private resource creation still pending" : "",
  targetId && !tabClosed ? "tab closure unconfirmed" : "",
  browserContextId && !contextDisposed ? "private context disposal unconfirmed" : "",
].filter(Boolean).join("; ");
if (uncertainty) throw new Error((failed ? String(failure?.message || failure) + "; " : "") + "Web cleanup uncertain: " + uncertainty);
if (failed) throw failure;
return result;
`;

export const webSearchSnippet = (query: string, limit: number, timeoutMs: number): string => pageSnippet(
  "https://www.google.com/search?hl=en&q=" + encodeURIComponent(query) + "&num=" + limit,
  `(() => {
    if (location.hostname === "consent.google.com" || location.pathname.startsWith("/sorry/") || document.querySelector('form[action*="consent.google"], #captcha-form, iframe[src*="recaptcha"]')) {
      throw new Error("Google consent or CAPTCHA blocked web.search; resolve it in the browser, then retry explicitly");
    }
    const clean = (value, max) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
    const results = [], seen = new Set();
    // h3-linked cards also cover layouts that no longer use .tF2Cxc.
    for (const heading of document.querySelectorAll("h3")) {
      const anchor = heading.closest("a[href]");
      if (!anchor) continue;
      let link;
      try {
        link = new URL(anchor.href, location.href);
        if (link.origin === location.origin && link.pathname === "/url") link = new URL(link.searchParams.get("q") || link.searchParams.get("url"));
      } catch { continue; }
      if (!["http:", "https:"].includes(link.protocol) || link.username || link.password || link.origin === location.origin || seen.has(link.href)) continue;
      const title = clean(heading.textContent, 300);
      if (!title) continue;
      const container = heading.closest(".tF2Cxc, .MjjYud, .g");
      results.push({ title, url: link.href.slice(0, 8192), snippet: clean(container?.querySelector(".VwiC3b, .IsZvec")?.textContent, 600) });
      seen.add(link.href);
      if (results.length >= ${limit}) break;
    }
    return JSON.stringify({ source: "google", query: ${JSON.stringify(query)}, results });
  })()`, "networkIdle", 0, timeoutMs,
);

export const webOpenSnippet = (url: string, selector: string, wait: "networkIdle" | "almostIdle" | "load", settleMs: number, maxChars: number, timeoutMs: number): string => pageSnippet(
  url,
  `(() => {
    const root = document.querySelector(${JSON.stringify(selector)}) || document.body;
    const raw = String(root?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    return JSON.stringify({
      url: ${JSON.stringify(url)}, finalUrl: location.href, title: String(document.title || "").slice(0, 500),
      text: raw.slice(0, ${maxChars}), chars: raw.length, truncated: raw.length > ${maxChars}, selector: ${JSON.stringify(selector)},
    });
  })()`, wait, settleMs, timeoutMs,
);
