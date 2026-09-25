// W5 caller regression support: bundle the real source admission entrypoint
// (src/kiro/mcp-entry.ts) with esbuild so the backend admission ordering can be
// exercised behaviourally without a full production build.

import path from "node:path";
import { pathToFileURL } from "node:url";

/** @param {string} repoRoot @param {string} outfile */
export async function bundleMcpEntry(repoRoot, outfile) {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "kiro", "mcp-entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
    write: true,
    external: ["./mcp-server.js", "./first-prompt-hook.js"],
    banner: { js: "// bundled from src/kiro/mcp-entry.ts for caller admission verification" },
  });
  if (result.errors?.length) throw new Error("esbuild failed: " + result.errors.map(e => e.text).join("; "));
  return import(pathToFileURL(outfile).href + "?v=" + Date.now());
}
