import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { removeFixtureSync } from "../fixture-cleanup.mjs";

export interface InstalledParser { path: string; sha256: string; version: string; generationRoot: string }

const VERSION = "0.45.3";
const closure = () => path.resolve("dist/kiro-agent-closure");
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const pinnedBinary = (): string | undefined => {
  const target = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
  try { return path.join(path.dirname(createRequire(path.resolve("package.json")).resolve(`@ast-grep/cli-${target}/package.json`)), "ast-grep"); }
  catch { return undefined; }
};

/** Lay out `app/` from the built closure and `tools/ast-grep` exactly as the installer does. */
const populate = (root: string, binary: string): InstalledParser => {
  fs.cpSync(closure(), path.join(root, "app"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools"), { mode: 0o700 });
  const parserPath = path.join(root, "tools", "ast-grep");
  fs.copyFileSync(binary, parserPath);
  fs.chmodSync(parserPath, 0o700);
  return { path: parserPath, sha256: hash(parserPath), version: VERSION, generationRoot: root };
};

/** A private installer-shaped root for one test file. Undefined when the build
 * output or the pinned npm platform parser is unavailable. */
export function createInstalledParser(): { parser: InstalledParser; dispose(): void } | undefined {
  const binary = pinnedBinary();
  if (!binary || !fs.existsSync(path.join(closure(), "closure-manifest.json"))) return undefined;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-installed-parser-")));
  fs.chmodSync(root, 0o700);
  return { parser: populate(root, binary), dispose: () => removeFixtureSync(root, { recursive: true, force: true }) };
}

/** One reusable installer-shaped root per build under the ignored `.tmp/`,
 * replaced when the build output changes. */
const cachedInstalledParser = (binary: string): InstalledParser | undefined => {
  const manifest = path.join(closure(), "closure-manifest.json");
  if (!fs.existsSync(manifest)) return undefined;
  const digest = String(JSON.parse(fs.readFileSync(manifest, "utf8")).contentDigest).slice(0, 16);
  fs.mkdirSync(path.resolve(".tmp"), { recursive: true, mode: 0o700 });
  const cache = path.resolve(".tmp/fovea-installed-parser");
  const root = path.join(cache, digest);
  const parserPath = path.join(root, "tools", "ast-grep");
  if (fs.existsSync(parserPath)) return { path: fs.realpathSync(parserPath), sha256: hash(parserPath), version: VERSION, generationRoot: fs.realpathSync(root) };
  if (fs.existsSync(cache)) removeFixtureSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(cache, ".staging-"));
  populate(staging, binary);
  fs.renameSync(staging, root);
  return { path: fs.realpathSync(parserPath), sha256: hash(parserPath), version: VERSION, generationRoot: fs.realpathSync(root) };
};

/** The pinned npm platform parser. Darwin source access needs the native
 * binding beside an installed app, so there it comes from the cached
 * installer-shaped root. `path` does not exist when the platform package or
 * build output is unavailable, so existence checks still skip cleanly. */
export function pinnedParser(): { path: string; sha256: string; version: string; generationRoot?: string } {
  const missing = { path: path.resolve(".tmp/missing-ast-grep"), sha256: "0".repeat(64), version: VERSION };
  const binary = pinnedBinary();
  if (!binary || !fs.existsSync(binary)) return missing;
  if (process.platform === "darwin") return cachedInstalledParser(binary) ?? missing;
  return { path: binary, sha256: hash(binary), version: VERSION };
}
