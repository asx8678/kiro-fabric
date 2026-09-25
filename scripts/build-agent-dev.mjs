#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgentPackage } from "./validate-agent-package.mjs";
import { verifyBuildClosure, verifyBuildCapture, verifyCapturedInputs } from "./build-inputs.mjs";
import { canonical, sha256 } from "./bundle-contract.mjs";
import { artifactRecords, cacheDirectory, exists, recordInstallerArtifact, withInstallerArtifactLease } from "./installer-artifacts.mjs";

const scripts = ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"];
const boundarySource = "src/installation/filesystem-boundary.mjs";
const boundaryTarget = "scripts/filesystem-boundary.mjs";
const lockSource = "src/installation/installer-lock.mjs";
const pinnedSource = "src/installation/pinned-recovery.mjs";
// W5 staged implementation closure: the legacy installer imports the modern
// compat lock, so its exact dependency bytes are captured and verified below,
// never a checkout re-export shim.
const helperSources = [[boundarySource, boundaryTarget], [lockSource, "scripts/installer-lock.mjs"], [pinnedSource, "scripts/pinned-recovery.mjs"]];
const mappings = [["skills/fabric-exec", "skills/fabric-exec"], ["agent-product.json", "agent-product.json"], ...scripts.map(name => [`scripts/${name}`, `scripts/${name}`]), ...helperSources];
const copy = (source, target) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || (!stats.isDirectory() && (!stats.isFile() || stats.nlink !== 1))) throw new Error(`unsafe source: ${source}`);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copy(path.join(source, entry), path.join(target, entry));
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600);
  }
};
export async function buildAgentDev(options = {}) {
  if (!["linux", "darwin"].includes(process.platform)) throw new Error(`Agent staging requires Linux or macOS (received ${process.platform})`);
  const root = fs.realpathSync(options.root ?? path.resolve("."));
  const initialBuild = verifyBuildClosure(root);
  const parent = cacheDirectory(root);
  if (!parent) throw new Error(".tmp must already be a private current-user directory");
  return withInstallerArtifactLease(root, async () => {
    const stable = path.join(parent, "kiro-fabric-agent");
    const building = path.join(parent, `.kiro-fabric-agent-building-${process.pid}-${randomBytes(8).toString("hex")}`);
    const identity = { inputs: initialBuild.buildInputs.digest, closure: sha256(fs.readFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"))), node: process.version, platform: process.platform, arch: process.arch };
    let previousStableTarget, active;
    if (exists(stable)) {
      if (!fs.lstatSync(stable).isSymbolicLink()) throw new Error("Existing Agent staging pointer is not a symlink");
      previousStableTarget = fs.readlinkSync(stable);
      if (path.isAbsolute(previousStableTarget) || previousStableTarget.includes(path.sep) || !/^\.kiro-fabric-agent-generation-[a-f0-9]{64}$/u.test(previousStableTarget)) throw new Error("Existing Agent staging pointer has an unsafe target");
      active = validateAgentPackage(stable); // even stale/tampered active generations cannot be hidden by a rebuild
    }
    let selected, generation = "", reused = false;
    {
      for (const record of await artifactRecords(parent, "agent")) {
        if (canonical(record.identity) !== canonical(identity)) continue;
        generation = path.join(parent, record.generation);
        selected = active?.root === generation ? active : validateAgentPackage(generation);
        if (selected.digest !== record.digest) throw new Error("Existing digest-named Agent generation differs from its reuse record");
        verifyBuildCapture(root, path.join(generation, "runtime"), initialBuild);
        if (sha256(fs.readFileSync(path.join(generation, "runtime/closure-manifest.json"))) !== identity.closure) throw new Error("Selected Agent manifest differs from reuse inputs");
        verifyCapturedInputs(generation, initialBuild, mappings);
        reused = true; break;
      }
      if (!selected) {
        fs.mkdirSync(building, { mode: 0o700 });
        console.error("[fabric:task-root] " + JSON.stringify({ path: building, policy: "retain-if-unpublished" }));
        copy(path.join(root, "dist/kiro-agent-closure"), path.join(building, "runtime"));
        fs.mkdirSync(path.join(building, "skills"), { mode: 0o700 });
        copy(path.join(root, "skills", "fabric-exec"), path.join(building, "skills", "fabric-exec"));
        copy(path.join(root, "agent-product.json"), path.join(building, "agent-product.json"));
        fs.mkdirSync(path.join(building, "scripts"), { mode: 0o700 });
        for (const name of scripts) copy(path.join(root, "scripts", name), path.join(building, "scripts", name));
        // Copy implementation bytes, NOT the checkout-only re-export shim.
        for (const [source, target] of helperSources) copy(path.join(root, source), path.join(building, target));
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        fs.writeFileSync(path.join(building, "package.json"), `${JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true, engines: { node: ">=24" }, scripts: { "install:agent": "node scripts/install-agent-user.mjs ." } }, null, 2)}\n`, { mode: 0o600 });
        verifyCapturedInputs(building, initialBuild, mappings);
        verifyBuildCapture(root, path.join(building, "runtime"), initialBuild);
        const provisional = validateAgentPackage(building);
        generation = path.join(parent, `.kiro-fabric-agent-generation-${provisional.digest}`);
        if (exists(generation)) {
          const s = fs.lstatSync(generation);
          if (!s.isDirectory() || s.isSymbolicLink()) throw new Error("Existing digest-named Agent generation is not a regular directory");
          selected = validateAgentPackage(generation);
          if (selected.digest !== provisional.digest || canonical(selected.inventory) !== canonical(provisional.inventory)) throw new Error("Existing digest-named Agent generation differs from the freshly staged package");
        } else {
          fs.renameSync(building, generation); selected = validateAgentPackage(generation);
        }
        if (selected.digest !== provisional.digest || canonical(selected.inventory) !== canonical(provisional.inventory)) throw new Error("Selected Agent generation differs from the freshly staged package");
      }
      // Independent publication checks remain separate from the reuse lookup.
      verifyBuildCapture(root, path.join(root, "dist/kiro-agent-closure"), initialBuild);
      if (sha256(fs.readFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"))) !== identity.closure || sha256(fs.readFileSync(path.join(generation, "runtime/closure-manifest.json"))) !== identity.closure) throw new Error("Agent closure manifest changed during capture");
      verifyBuildCapture(root, path.join(generation, "runtime"), initialBuild);
      verifyCapturedInputs(generation, initialBuild, mappings);
      await recordInstallerArtifact(parent, { schema: 1, kind: "agent", generation: path.basename(generation), digest: selected.digest, identity });
      const link = `${stable}.next-${process.pid}-${randomBytes(8).toString("hex")}`;
      let published = false;
      try {
        fs.symlinkSync(path.basename(generation), link, "dir"); fs.renameSync(link, stable); published = true;
        const result = validateAgentPackage(stable);
        if (result.digest !== selected.digest || canonical(result.inventory) !== canonical(selected.inventory)) throw new Error("Published Agent staging pointer differs from the selected package");
        verifyBuildCapture(root, path.join(root, "dist/kiro-agent-closure"), initialBuild);
        if (sha256(fs.readFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"))) !== identity.closure) throw new Error("Agent closure manifest changed during publication");
        return { ok: result.ok, root: result.root, version: result.version, digest: result.digest, files: result.files, bytes: result.bytes, generation, reused };
      } catch (error) {
        try { fs.unlinkSync(link); } catch {}
        if (published) {
          const rollback = `${stable}.rollback-${process.pid}-${randomBytes(8).toString("hex")}`;
          try {
            if (previousStableTarget === undefined) fs.unlinkSync(stable);
            else { fs.symlinkSync(previousStableTarget, rollback, "dir"); fs.renameSync(rollback, stable); }
          } catch (rollbackError) {
            try { fs.unlinkSync(rollback); } catch {}
            throw new AggregateError([error, rollbackError], "Agent staging publication failed and its prior pointer could not be restored");
          }
        }
        throw error;
      }
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildAgentDev();
  process.stdout.write(`${JSON.stringify(result)}\n${path.join(path.dirname(result.generation), "kiro-fabric-agent")}\n`);
}
