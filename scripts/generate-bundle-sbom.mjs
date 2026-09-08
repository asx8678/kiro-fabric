import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle, sha256 } from "./bundle-contract.mjs";
import { writeFileAtomic } from "./atomic-file.mjs";
export async function generateBundleSbom(root) {
  const bundle = await validateBundle(root);
  const closure = JSON.parse(fs.readFileSync(path.join(root, "app", "closure-manifest.json"), "utf8"));
  const packages = [{ SPDXID: "SPDXRef-Fabric", name: "kiro-fabric", versionInfo: bundle.version, downloadLocation: "https://github.com/asx8678/kiro-fabric", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: "MIT", checksums: [{ algorithm: "SHA256", checksumValue: bundle.digest }] }];
  for (const component of closure.packageInputs) packages.push({ SPDXID: `SPDXRef-npm-${component.name.replace(/[^A-Za-z0-9.-]/gu, "-")}`, name: component.name, versionInfo: component.version, downloadLocation: `https://registry.npmjs.org/${component.name}`, filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: component.license || "NOASSERTION", checksums: [] });
  for (const name of ["node", "rg"]) {
    const tool = bundle.manifest.tools[name], executable = tool.members.find(member => member.path === `tools/${name}`);
    packages.push({ SPDXID: `SPDXRef-binary-${name}`, name: name === "node" ? "Node.js" : "ripgrep", versionInfo: tool.version, downloadLocation: tool.url, filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: name === "node" ? "MIT" : "MIT OR Unlicense", checksums: [{ algorithm: "SHA256", checksumValue: executable.sha256 }] });
  }
  return { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: `kiro-fabric-${bundle.manifest.target}`, documentNamespace: `https://github.com/asx8678/kiro-fabric/sbom/${bundle.digest}`, creationInfo: { created: "1970-01-01T00:00:00.000Z", creators: ["Tool: kiro-fabric-complete-bundle-sbom"] }, packages,
    files: bundle.inventory.map((entry, index) => ({ SPDXID: `SPDXRef-File-${index}`, fileName: entry.path, checksums: [{ algorithm: "SHA256", checksumValue: entry.sha256 }], licenseConcluded: "NOASSERTION", copyrightText: "NOASSERTION" })),
    relationships: [{ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Fabric" }, ...packages.slice(1).map(component => ({ spdxElementId: "SPDXRef-Fabric", relationshipType: "DEPENDS_ON", relatedSpdxElement: component.SPDXID }))],
    documentComment: "Complete app/private Node/private ripgrep/manager/resources inventory. Node and ripgrep embedded component attribution is retained in exact upstream LICENSE/COPYING notices. OS libraries and project-specific tools remain external. Native qualification is separate from this SBOM." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pointer = JSON.parse(fs.readFileSync(".tmp/complete-bundle.json", "utf8"));
  const document = await generateBundleSbom(pointer.root), text = JSON.stringify(document, null, 2) + "\n";
  const output = `.tmp/kiro-fabric-${pointer.target}.spdx.json`; writeFileAtomic(path.resolve(output), text);
  console.log(JSON.stringify({ output, sha256: sha256(text), packages: document.packages.length, files: document.files.length }));
}
