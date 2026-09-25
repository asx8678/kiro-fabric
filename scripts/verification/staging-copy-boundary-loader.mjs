// Test-only ESM loader for I07's deterministic copy boundary. It rewrites an
// import of scripts/bundle-contract.mjs to a private patched instance only when
// the exact intended importer is a tagged boundary stage module. Production
// modules, canonical contract imports and unrelated staging instances are never
// touched: the wrapper delegates to the real captureRegular byte-for-byte.
//
// `register()` has no unregister API, so this hook stays installed for the
// process. It is inert for every untagged import, and the boundary helper is
// restricted to the disposable verification worker (see
// staging-copy-boundary.mjs). No production, installer or installed-agent code
// references this loader.

const TAG_PARAM = "kiro-fabric-staging-boundary";
const PATCH_PARAM = "kiro-fabric-staging-boundary-patch";
const ORIGINAL_PARAM = "kiro-fabric-staging-boundary-original";
const BOUNDARY_KEY = "__KIRO_FABRIC_STAGING_COPY_BOUNDARY__";

const CONTRACT_URL = new URL("../bundle-contract.mjs", import.meta.url);
const STAGE_URL = new URL("../source-bundle-stage.mjs", import.meta.url);
const TOKEN_PATTERN = /^[a-z0-9-]{1,64}$/u;

/**
 * The only importer allowed to redirect the contract is a source-bundle-stage
 * module carrying a non-empty boundary token. Everything else, including the
 * canonical stage module and unrelated tagged stage instances, resolves
 * unchanged.
 * @param {string|undefined} parentURL
 * @returns {string|null}
 */
function boundaryTokenFor(parentURL) {
  if (typeof parentURL !== "string" || !parentURL.startsWith("file:")) return null;
  const parent = new URL(parentURL);
  if (parent.pathname !== STAGE_URL.pathname) return null;
  const token = parent.searchParams.get(TAG_PARAM);
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** @param {string} specifier @param {{parentURL?:string}} context @param {(specifier:string, context:any)=>Promise<any>} nextResolve */
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (typeof resolved.url !== "string" || resolved.url !== CONTRACT_URL.href) return resolved;
  const token = boundaryTokenFor(context && context.parentURL);
  if (token === null) return resolved;
  const patched = new URL(resolved.url);
  patched.searchParams.set(PATCH_PARAM, token);
  return { ...resolved, url: patched.href, shortCircuit: true };
}

/** @param {string} url @param {any} context @param {(url:string, context:any)=>Promise<any>} nextLoad */
export async function load(url, context, nextLoad) {
  if (typeof url !== "string" || !url.startsWith("file:")) return nextLoad(url, context);
  const parsed = new URL(url);
  const token = parsed.searchParams.get(PATCH_PARAM);
  if (token === null || parsed.pathname !== CONTRACT_URL.pathname || !TOKEN_PATTERN.test(token)) return nextLoad(url, context);
  const original = new URL(CONTRACT_URL.href);
  original.searchParams.set(ORIGINAL_PARAM, token);
  const source = [
    "import { captureRegular as __realCaptureRegular } from " + JSON.stringify(original.href) + ";",
    "export * from " + JSON.stringify(original.href) + ";",
    "const __INSTANCE = " + JSON.stringify(token) + ";",
    "export async function captureRegular(file, max, consume, options) {",
    "  const boundary = globalThis[" + JSON.stringify(BOUNDARY_KEY) + "];",
    "  if (boundary && boundary.instance === __INSTANCE && typeof boundary.shouldPause === \"function\" && boundary.shouldPause(file) && typeof boundary.pause === \"function\") {",
    "    await boundary.pause(file);",
    "  }",
    "  return __realCaptureRegular(file, max, consume, options);",
    "}",
    "",
  ].join("\n");
  return { format: "module", source, shortCircuit: true };
}
