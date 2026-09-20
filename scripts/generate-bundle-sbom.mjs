import { vendoredSbomPackages } from "./generate-vendored-sbom.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle, sha256, hashRegular, readRegular, LIMITS } from "./bundle-contract.mjs";
import { withInstallerArtifactLease } from "./installer-artifacts.mjs";
import { writeFileAtomic } from "./atomic-file.mjs";
export async function generateBundleSbom(root) {
  const bundle = await validateBundle(root);
  const record = bundle.inventory.find(entry => entry.path === "app/closure-manifest.json");
  if (!record) throw Error("Missing SBOM closure inventory");
  const closureBytes = await readRegular(path.join(bundle.root, record.path), Math.min(record.size, LIMITS.manifest), { mode: record.mode });
  if (closureBytes.length !== record.size || sha256(closureBytes) !== record.sha256) throw Error("SBOM closure changed after validation");
  const closure = JSON.parse(closureBytes.toString("utf8"));
  const packages = [{ SPDXID: "SPDXRef-Fabric", name: "kiro-fabric", versionInfo: bundle.version, downloadLocation: "https://github.com/asx8678/kiro-fabric", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: "MIT", checksums: [{ algorithm: "SHA256", checksumValue: bundle.digest }] }];
  for (const component of closure.packageInputs) packages.push({ SPDXID: `SPDXRef-npm-${component.name.replace(/[^A-Za-z0-9.-]/gu, "-")}`, name: component.name, versionInfo: component.version, downloadLocation: `https://registry.npmjs.org/${component.name}`, filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: component.license || "NOASSERTION", checksums: [] });
  packages.push(...vendoredSbomPackages(closure));
  for (const name of Object.keys(bundle.manifest.tools)) {
    const tool = bundle.manifest.tools[name], executable = tool.members.find(member => member.path === `tools/${name}`);
    packages.push({ SPDXID: `SPDXRef-binary-${name}`, name: name === "node" ? "Node.js" : name === "rg" ? "ripgrep" : "ast-grep", versionInfo: tool.version, downloadLocation: tool.url, filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: name === "rg" ? "MIT OR Unlicense" : "MIT", checksums: [{ algorithm: "SHA256", checksumValue: executable.sha256 }] });
  }
  return { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: `kiro-fabric-${bundle.manifest.target}`, documentNamespace: `https://github.com/asx8678/kiro-fabric/sbom/${bundle.digest}`, creationInfo: { created: "1970-01-01T00:00:00.000Z", creators: ["Tool: kiro-fabric-complete-bundle-sbom"] }, packages,
    files: bundle.inventory.map((entry, index) => ({ SPDXID: `SPDXRef-File-${index}`, fileName: entry.path, checksums: [{ algorithm: "SHA256", checksumValue: entry.sha256 }], licenseConcluded: "NOASSERTION", copyrightText: "NOASSERTION" })),
    relationships: [{ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Fabric" }, ...packages.slice(1).map(component => ({ spdxElementId: "SPDXRef-Fabric", relationshipType: "DEPENDS_ON", relatedSpdxElement: component.SPDXID }))],
    documentComment: "Complete app/private Node/private ripgrep/private ast-grep/manager/resources inventory. Vendored Fovea is explicitly attributed, not an npm runtime dependency. Parser notices and the upstream MIT license are retained. Node and ripgrep embedded component attribution is retained in exact upstream LICENSE/COPYING notices. OS libraries and project-specific tools remain external. Native qualification is separate from this SBOM." };
}
/** Generate data-only sidecars; this does NOT sign or qualify a release.
 * Archive descriptors name captured bytes; promotion must authenticate snapshots.
 * @param {string} [root] */
export async function generateBundleSbomOutputs(root = process.cwd()) {
  root = fs.realpathSync(root);
  return withInstallerArtifactLease(root, async () => {
    const directory = path.join(root, ".tmp");
    const pointer = JSON.parse((await readRegular(path.join(directory, "complete-bundle.json"), 2 * 1024 * 1024, { mode: 0o600 })).toString("utf8"));
    const document = await generateBundleSbom(pointer.root), text = JSON.stringify(document, null, 2) + "\n";
    const output = path.join(directory, document.name + ".spdx.json");
    let archive = null, archiveSidecar = null;
    if (pointer.archive != null) {
      const expected = path.join(directory, document.name + ".tar.gz");
      if (typeof pointer.archive !== "string" || path.resolve(pointer.archive) !== expected) throw Error("Unexpected complete-bundle archive path");
      const captured = await hashRegular(expected, LIMITS.archive, { mode: 0o600 });
      archive = { path: expected, size: captured.size, sha256: captured.sha256 };
      archiveSidecar = expected + ".spdx.json";
    }
    writeFileAtomic(output, text);
    if (archiveSidecar) writeFileAtomic(archiveSidecar, text);
    return { output, archiveSidecar, archive, sha256: sha256(text), sbom: { size: Buffer.byteLength(text), sha256: sha256(text) }, packages: document.packages.length, files: document.files.length };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await generateBundleSbomOutputs()));
