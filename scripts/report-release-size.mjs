#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_DIVISOR = 4;
const CONTEXT_TOKEN_CEILING = 1_500;

const walk = (directory) => {
  const files = new Map();
  if (!fs.existsSync(directory)) return files;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.set(path.relative(root, full).split(path.sep).join("/"), fs.statSync(full).size);
    }
  };
  visit(directory);
  return files;
};

const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
};

const headFile = (file) => git(["show", `HEAD:${file}`]);
const headTree = (directory) => {
  const output = git(["ls-tree", "-rl", "--full-tree", "HEAD", directory]);
  const files = new Map();
  for (const line of output?.split("\n") ?? []) {
    const match = line.match(/^\d+\s+blob\s+[0-9a-f]+\s+(\d+)\t(.+)$/u);
    if (match) files.set(match[2], Number(match[1]));
  }
  return files;
};

const sum = (files) => [...files.values()].reduce((total, bytes) => total + bytes, 0);
const largest = (files, limit = 8) => [...files]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .slice(0, limit)
  .map(([file, bytes]) => ({ file, bytes }));

const frontmatterMetadataBytes = (content) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) throw new Error("repository skill lacks YAML frontmatter");
  const metadata = parseYaml(match[1]);
  return Buffer.byteLength(`${metadata.name}\n${metadata.description}\n`);
};

const currentContext = () => {
  const profile = JSON.parse(fs.readFileSync(path.join(root, ".kiro/agents/kiro-fabric-dev.json"), "utf8"));
  const directResources = profile.resources
    .filter((resource) => resource.startsWith("file://"))
    .map((resource) => resource.slice("file://".length));
  const resources = directResources.map((file) => ({ file, bytes: fs.statSync(path.join(root, file)).size }));
  const skillFiles = [...walk(path.join(root, ".kiro/skills")).keys()].filter((file) => file.endsWith("/SKILL.md"));
  const skillMetadataBytes = skillFiles.reduce((total, file) =>
    total + frontmatterMetadataBytes(fs.readFileSync(path.join(root, file), "utf8")), 0);
  const inlinePromptBytes = Buffer.byteLength(profile.prompt);
  const totalBytes = inlinePromptBytes + skillMetadataBytes + resources.reduce((total, item) => total + item.bytes, 0);
  return {
    inlinePromptBytes,
    directlyLoadedResources: resources,
    lazySkillMetadataBytes: skillMetadataBytes,
    totalBytes,
    estimatedTokens: Math.ceil(totalBytes / TOKEN_DIVISOR),
  };
};

const headContext = () => {
  const raw = headFile(".kiro/agents/kiro-fabric-dev.json");
  if (!raw) return null;
  const profile = JSON.parse(raw);
  const steeringFiles = (git(["ls-tree", "-r", "--name-only", "HEAD", ".kiro/steering"]) ?? "")
    .split("\n").filter((file) => file.endsWith(".md"));
  const direct = new Set();
  for (const resource of profile.resources ?? []) {
    if (resource === "file://.kiro/steering/**/*.md") for (const file of steeringFiles) direct.add(file);
    else if (resource.startsWith("file://")) direct.add(resource.slice("file://".length));
  }
  const resources = [...direct].map((file) => ({ file, bytes: Buffer.byteLength(headFile(file) ?? "") }));
  const inlinePromptBytes = Buffer.byteLength(profile.prompt ?? "");
  const totalBytes = inlinePromptBytes + resources.reduce((total, item) => total + item.bytes, 0);
  return {
    inlinePromptBytes,
    directlyLoadedResources: resources,
    lazySkillMetadataBytes: 0,
    totalBytes,
    estimatedTokens: Math.ceil(totalBytes / TOKEN_DIVISOR),
  };
};

const closure = (name) => {
  const directory = `dist/${name}`;
  const current = walk(path.join(root, directory));
  const before = headTree(directory);
  const changes = new Map();
  for (const file of new Set([...current.keys(), ...before.keys()])) {
    const delta = (current.get(file) ?? 0) - (before.get(file) ?? 0);
    if (delta !== 0) changes.set(file, delta);
  }
  return {
    beforeBytes: sum(before),
    afterBytes: sum(current),
    deltaBytes: sum(current) - sum(before),
    fileCount: current.size,
    largestFiles: largest(current),
    largestDeltas: [...changes]
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([file, deltaBytes]) => ({ file, deltaBytes })),
  };
};

const beforeContext = headContext();
const afterContext = currentContext();
const report = {
  ok: afterContext.estimatedTokens <= CONTEXT_TOKEN_CEILING,
  ceilings: { alwaysLoadedRepositoryTokens: CONTEXT_TOKEN_CEILING, tokenEstimateCharsPerToken: TOKEN_DIVISOR },
  developmentAgentContext: {
    before: beforeContext,
    after: afterContext,
    deltaBytes: beforeContext ? afterContext.totalBytes - beforeContext.totalBytes : null,
    deltaEstimatedTokens: beforeContext ? afterContext.estimatedTokens - beforeContext.estimatedTokens : null,
  },
  closures: {
    managed: closure("kiro-closure"),
    power: closure("kiro-power-closure"),
  },
  skillBytes: {
    power: sum(walk(path.join(root, "skills"))),
    strict: sum(walk(path.join(root, "strict/skills"))),
    development: sum(walk(path.join(root, ".kiro/skills"))),
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--check") && !report.ok) {
  process.stderr.write(`release size report: development-agent context ${afterContext.estimatedTokens} estimated tokens exceeds ${CONTEXT_TOKEN_CEILING}\n`);
  process.exitCode = 1;
}
