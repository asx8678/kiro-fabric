#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateAgentPackage } from "./validate-agent-package.mjs";

if (!["linux", "darwin"].includes(process.platform)) {
  throw new Error(`Agent staging requires Linux or macOS (received ${process.platform})`);
}

const parent = fs.realpathSync(path.resolve(".tmp"));
const parentStats = fs.lstatSync(parent);
if (!parentStats.isDirectory() || parentStats.isSymbolicLink() ||
    (typeof process.getuid === "function" && parentStats.uid !== process.getuid()) ||
    (process.platform !== "win32" && (parentStats.mode & 0o077) !== 0)) {
  throw new Error(".tmp must already be a private current-user directory");
}

const stable = path.join(parent, "kiro-fabric-agent");
const building = path.join(parent, `.kiro-fabric-agent-building-${process.pid}-${randomBytes(8).toString("hex")}`);
const copy = (source, target) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || (!stats.isDirectory() && (!stats.isFile() || stats.nlink !== 1))) {
    throw new Error(`unsafe source: ${source}`);
  }
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copy(path.join(source, entry), path.join(target, entry));
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
};

try {
  fs.mkdirSync(building, { mode: 0o700 });
  copy("dist/kiro-agent-closure", path.join(building, "runtime"));
  copy("skills", path.join(building, "skills"));
  copy("agent-product.json", path.join(building, "agent-product.json"));
  fs.mkdirSync(path.join(building, "scripts"), { mode: 0o700 });
  for (const name of ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"]) {
    copy(path.join("scripts", name), path.join(building, "scripts", name));
  }
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  fs.writeFileSync(path.join(building, "package.json"), `${JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    type: "module",
    private: true,
    engines: { node: ">=24" },
    scripts: { "install:agent": "node scripts/install-agent-user.mjs ." },
  }, null, 2)}\n`, { mode: 0o600 });

  const provisional = validateAgentPackage(building);
  const generation = path.join(parent, `.kiro-fabric-agent-generation-${provisional.digest}`);
  let selected;
  if (fs.existsSync(generation)) {
    const generationStats = fs.lstatSync(generation);
    if (!generationStats.isDirectory() || generationStats.isSymbolicLink()) {
      throw new Error("Existing digest-named Agent generation is not a regular directory");
    }
    selected = validateAgentPackage(generation);
    if (selected.digest !== provisional.digest ||
        JSON.stringify(selected.inventory) !== JSON.stringify(provisional.inventory)) {
      throw new Error("Existing digest-named Agent generation differs from the freshly staged package");
    }
    fs.rmSync(building, { recursive: true });
  } else {
    fs.renameSync(building, generation);
    selected = validateAgentPackage(generation);
  }
  if (selected.digest !== provisional.digest ||
      JSON.stringify(selected.inventory) !== JSON.stringify(provisional.inventory)) {
    throw new Error("Selected Agent generation differs from the freshly staged package");
  }

  let previousStableTarget;
  try {
    const previousStableStats = fs.lstatSync(stable);
    if (!previousStableStats.isSymbolicLink()) throw new Error("Existing Agent staging pointer is not a symlink");
    previousStableTarget = fs.readlinkSync(stable);
    if (path.isAbsolute(previousStableTarget) || previousStableTarget.includes(path.sep) ||
        !/^\.kiro-fabric-agent-generation-[a-f0-9]{64}$/u.test(previousStableTarget)) {
      throw new Error("Existing Agent staging pointer has an unsafe target");
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }

  const link = `${stable}.next-${process.pid}`;
  let published = false;
  try {
    fs.symlinkSync(path.basename(generation), link, "dir");
    fs.renameSync(link, stable);
    published = true;
    const result = validateAgentPackage(stable);
    if (result.digest !== provisional.digest ||
        JSON.stringify(result.inventory) !== JSON.stringify(provisional.inventory)) {
      throw new Error("Published Agent staging pointer differs from the freshly staged package");
    }
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      root: result.root,
      version: result.version,
      digest: result.digest,
      files: result.files,
      bytes: result.bytes,
      generation,
    })}\n${stable}\n`);
  } catch (error) {
    try { fs.unlinkSync(link); } catch {}
    if (published) {
      const rollback = `${stable}.rollback-${process.pid}-${randomBytes(8).toString("hex")}`;
      try {
        if (previousStableTarget === undefined) fs.unlinkSync(stable);
        else {
          fs.symlinkSync(previousStableTarget, rollback, "dir");
          fs.renameSync(rollback, stable);
        }
      } catch (rollbackError) {
        try { fs.unlinkSync(rollback); } catch {}
        throw new AggregateError([error, rollbackError], "Agent staging publication failed and its prior pointer could not be restored");
      }
    }
    throw error;
  }
} catch (error) {
  fs.rmSync(building, { recursive: true, force: true });
  throw error;
}
