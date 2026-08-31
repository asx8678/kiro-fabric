#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error("Usage: node scripts/generate-power-sbom.mjs --output <path>");
}
const output = path.resolve(process.argv[outputIndex + 1]);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = YAML.parse(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));

const parsePackageKey = (raw) => {
  const key = String(raw).replace(/^\//, "").replace(/\(.+\)$/u, "");
  const separator = key.lastIndexOf("@");
  if (separator <= 0) return { name: key, version: "NOASSERTION" };
  return { name: key.slice(0, separator), version: key.slice(separator + 1) };
};
const safeId = (value) => value.replace(/[^A-Za-z0-9.-]/gu, "-");
const dependencyPackages = [...new Map(
  Object.keys(lock.packages ?? {})
    .map(parsePackageKey)
    .filter((entry) => entry.name && entry.version)
    .map((entry) => [`${entry.name}@${entry.version}`, entry]),
).values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));

const closureRoot = path.join(root, "dist", "kiro-power-closure");
const closureFiles = [];
const walk = (directory, prefix = "") => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, relative);
    else if (entry.isFile()) closureFiles.push({ relative, target });
  }
};
walk(closureRoot);
const closureHash = createHash("sha256");
for (const file of closureFiles.sort((left, right) => left.relative.localeCompare(right.relative))) {
  closureHash.update(file.relative).update("\0").update(readFileSync(file.target));
}
const rootId = `SPDXRef-Package-${safeId(pkg.name)}`;
const packages = [
  {
    SPDXID: rootId,
    name: pkg.name,
    versionInfo: pkg.version,
    downloadLocation: pkg.repository?.url ?? "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: pkg.license ?? "NOASSERTION",
    licenseDeclared: pkg.license ?? "NOASSERTION",
    supplier: "NOASSERTION",
    checksums: [{ algorithm: "SHA256", checksumValue: closureHash.digest("hex") }],
    comment: `Power closure: ${closureFiles.length} files, ${closureFiles.reduce((sum, file) => sum + statSync(file.target).size, 0)} bytes`,
  },
  ...dependencyPackages.map(({ name, version }) => ({
    SPDXID: `SPDXRef-Package-${safeId(`${name}-${version}`)}`,
    name,
    versionInfo: version,
    downloadLocation: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    supplier: "NOASSERTION",
  })),
];
const namespaceHash = createHash("sha256").update(`${pkg.name}@${pkg.version}:${packages.length}`).digest("hex");
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${pkg.name}-${pkg.version}-power-sbom`,
  documentNamespace: `https://github.com/asx8678/kiro-fabric/sbom/${namespaceHash}`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ["Tool: kiro-fabric-generate-power-sbom"],
  },
  packages,
  relationships: packages.map((entry) => ({
    spdxElementId: "SPDXRef-DOCUMENT",
    relationshipType: "DESCRIBES",
    relatedSpdxElement: entry.SPDXID,
  })),
};
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${output}\n`);
