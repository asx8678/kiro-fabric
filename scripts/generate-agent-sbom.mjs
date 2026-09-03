#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-file.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = valueAfter("--output");
if (!output) throw new Error("Usage: generate-agent-sbom --output <path> [--package <staged-agent>]");
const packageEvidence = validateAgentPackage(path.resolve(valueAfter("--package") ?? ".tmp/kiro-fabric-agent"));
const pkg = JSON.parse(fs.readFileSync(path.join(packageEvidence.root, "package.json"), "utf8"));
const closureRoot = path.join(packageEvidence.root, "runtime");
const closure = JSON.parse(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"), "utf8"));
const files = [];
const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else if (entry.isFile()) files.push(target); } };
walk(closureRoot);
const safe = (value) => value.replace(/[^A-Za-z0-9.-]/gu, "-");
const rootId = `SPDXRef-Package-${safe(pkg.name)}`;
const dependencies = closure.packageInputs.map(({ name, version, license }) => ({
  SPDXID: "SPDXRef-Package-" + safe(name + "-" + version),
  name,
  versionInfo: version,
  downloadLocation: `https://registry.npmjs.org/${name}`,
  filesAnalyzed: false,
  licenseConcluded: "NOASSERTION",
  licenseDeclared: typeof license === "string" && license ? license : "NOASSERTION",
  supplier: "NOASSERTION",
}));
const packages = [{
  SPDXID: rootId,
  name: pkg.name,
  versionInfo: pkg.version,
  downloadLocation: "https://github.com/asx8678/kiro-fabric",
  filesAnalyzed: false,
  licenseConcluded: "MIT",
  licenseDeclared: "MIT",
  supplier: "NOASSERTION",
  checksums: [{ algorithm: "SHA256", checksumValue: packageEvidence.digest }],
  comment: `Exact complete staged Agent package: ${packageEvidence.files} files, ${packageEvidence.bytes} bytes; runtime closure: ${files.length} files`,
}, ...dependencies];
const created = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? "0") * 1_000).toISOString();
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${pkg.name}-${pkg.version}-agent-sbom`,
  documentNamespace: `https://github.com/asx8678/kiro-fabric/sbom/${packageEvidence.digest}`,
  creationInfo: { created, creators: ["Tool: kiro-fabric-generate-agent-sbom"] },
  packages,
  relationships: [
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: rootId },
    ...dependencies.map((entry) => ({ spdxElementId: rootId, relationshipType: "DEPENDS_ON", relatedSpdxElement: entry.SPDXID })),
  ],
};
const target = writeFileAtomic(path.resolve(output), `${JSON.stringify(document, null, 2)}\n`);
console.log(JSON.stringify({ output: target, packageDigest: packageEvidence.digest, packages: packages.length }));
