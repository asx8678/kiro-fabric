#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("Usage: generate-power-sbom --output <path>");
const output = path.resolve(process.argv[outputIndex + 1]);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const closureRoot = path.resolve("dist/kiro-power-closure");
const closure = JSON.parse(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"), "utf8"));
const files = [];
const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else if (entry.isFile()) files.push(target); } };
walk(closureRoot);
const digest = createHash("sha256");
for (const file of files) digest.update(path.relative(closureRoot, file).replaceAll("\\", "/")).update("\0").update(fs.readFileSync(file));
const closureDigest = digest.digest("hex");
const safe = (value) => value.replace(/[^A-Za-z0-9.-]/gu, "-");
const rootId = `SPDXRef-Package-${safe(pkg.name)}`;
const dependencies = closure.packageInputs.map(({ name, version, license }) => ({
  SPDXID: `SPDXRef-Package-${safe(`${name}-${version}`)}`,
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
  downloadLocation: pkg.repository.url,
  filesAnalyzed: false,
  licenseConcluded: pkg.license,
  licenseDeclared: pkg.license,
  supplier: "NOASSERTION",
  checksums: [{ algorithm: "SHA256", checksumValue: closureDigest }],
  comment: `Exact packaged Power closure: ${files.length} files, ${files.reduce((sum, file) => sum + fs.statSync(file).size, 0)} bytes`,
}, ...dependencies];
const created = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? "0") * 1_000).toISOString();
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${pkg.name}-${pkg.version}-power-sbom`,
  documentNamespace: `https://github.com/asx8678/kiro-fabric/sbom/${closureDigest}`,
  creationInfo: { created, creators: ["Tool: kiro-fabric-generate-power-sbom"] },
  packages,
  relationships: [
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: rootId },
    ...dependencies.map((entry) => ({ spdxElementId: rootId, relationshipType: "DEPENDS_ON", relatedSpdxElement: entry.SPDXID })),
  ],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, closureDigest, packages: packages.length }));
