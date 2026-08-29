#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  assertPackagePolicy,
  PUBLIC_DECLARATION_ROOTS,
} from "./package-policy.mjs";

assertPackagePolicy();

const dist = resolve("dist");
const publicDeclarations = PUBLIC_DECLARATION_ROOTS.map((file) => resolve(file));

const declarationImports = (source) => [
  ...source.matchAll(/(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g),
  ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
].map((match) => match[1]).filter(Boolean);

const declarationTarget = (file, specifier) => {
  const base = resolve(dirname(file), specifier);
  const candidates = [
    base,
    base.replace(/\.(?:c|m)?js$/u, ".d.ts"),
    base + ".d.ts",
    join(base, "index.d.ts"),
  ];
  return candidates.find((candidate) => candidate.endsWith(".d.ts") && existsSync(candidate));
};

const retained = new Set();
const stack = [...publicDeclarations];
while (stack.length > 0) {
  const file = stack.pop();
  if (!file || retained.has(file)) continue;
  if (!existsSync(file)) throw new Error("Missing public declaration root: " + file);
  retained.add(file);
  for (const specifier of declarationImports(readFileSync(file, "utf8"))) {
    if (!specifier.startsWith(".")) continue;
    const target = declarationTarget(file, specifier);
    if (target) stack.push(target);
  }
}

const declarations = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith(".d.ts")) declarations.push(file);
  }
};
visit(dist);

let removed = 0;
for (const file of declarations) {
  if (retained.has(file)) continue;
  rmSync(file);
  rmSync(file + ".map", { force: true });
  removed += 1;
}
console.log("Pruned " + removed + " private declarations; retained " + retained.size + " public declaration files");
