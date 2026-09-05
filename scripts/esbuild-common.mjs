/** Shared esbuild options for both bundle graphs: the externalized library
 * build (`scripts/build.mjs`) and the closed agent runtime closure
 * (`scripts/build-kiro-closure.mjs`). Entry points, output directories, and
 * dependency policy stay per-script; everything that must not drift between
 * the two graphs lives here.
 * @type {import("esbuild").BuildOptions} */
export const sharedEsbuildOptions = {
  outbase: "src",
  entryNames: "[dir]/[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: true,
  sourcemap: false,
};
