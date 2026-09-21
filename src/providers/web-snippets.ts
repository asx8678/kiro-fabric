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
  // Target.disposeBrowserContext closes every belonging page (CDP contract).
  // A concurrent closeTab may therefore reject because its target is already
  // gone. Confirmed context disposal is stronger evidence than that tab ACK.
  targetId && !tabClosed && !contextDisposed ? "tab closure unconfirmed" : "",
  browserContextId && !contextDisposed ? "private context disposal unconfirmed" : "",
].filter(Boolean).join("; ");
if (uncertainty) throw new Error((failed ? String(failure?.message || failure) + "; " : "") + "Web cleanup uncertain: " + uncertainty);
if (failed) throw failure;
return result;
`;

export const webSearchSnippet = (query: string, limit: number, timeoutMs: number, engine: "google" | "bing" = "google"): string => pageSnippet(
  (engine === "bing" ? "https://www.bing.com/search?q=" : "https://www.google.com/search?hl=en&q=") + encodeURIComponent(query) + (engine === "bing" ? "&count=" : "&num=") + limit,
  `(() => {
    const engine = ${JSON.stringify(engine)};
    // Return fixed categories, not page text or daemon stderr. Context cleanup
    // still has to complete before the host receives this failure envelope.
    const blocked = (code) => JSON.stringify({ fabricWebError: code });
    if (engine === "google" && (location.hostname === "consent.google.com" || document.querySelector('form[action*="consent.google"]'))) return blocked("consent");
    const origin = engine === "bing" ? "https://www.bing.com" : "https://www.google.com";
    if (location.origin !== origin) return blocked("unexpected-redirect");
    if (location.pathname.startsWith("/sorry/") || document.querySelector('#b_captcha, #captcha-form, iframe[src*="captcha"]')) return blocked("captcha");
    const clean = (value, max) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
    const results = [], seen = new Set();
    for (const heading of document.querySelectorAll(engine === "bing" ? ".b_algo h2 a" : "h3")) {
      const anchor = engine === "bing" ? heading : heading.closest("a[href]");
      if (!anchor) continue;
      let link;
      try {
        link = new URL(anchor.href, location.href);
        if (engine === "google" && link.origin === location.origin && link.pathname === "/url") link = new URL(link.searchParams.get("q") || link.searchParams.get("url"));
        if (engine === "bing" && link.origin === location.origin && link.pathname === "/ck/a") {
          const encoded = link.searchParams.get("u") || "";
          if (!encoded.startsWith("a1") || encoded.length > 12000) continue;
          const decoded = atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/"));
          link = new URL(decodeURIComponent(Array.from(decoded, c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
        }
      } catch { continue; }
      if (!["http:", "https:"].includes(link.protocol) || link.username || link.password || link.origin === location.origin || seen.has(link.href)) continue;
      const title = clean(heading.textContent, 300);
      if (!title) continue;
      const container = heading.closest(engine === "bing" ? ".b_algo" : ".tF2Cxc, .MjjYud, .g");
      results.push({ title, url: link.href.slice(0, 8192), snippet: clean(container?.querySelector(engine === "bing" ? ".b_caption p, .b_snippet, p" : ".VwiC3b, .IsZvec")?.textContent, 600) });
      seen.add(link.href);
      if (results.length >= ${limit}) break;
    }
    return JSON.stringify({ source: engine, query: ${JSON.stringify(query)}, results });
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
