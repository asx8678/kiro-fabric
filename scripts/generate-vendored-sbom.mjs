/** Vendored source is not an npm production dependency. Preserve its explicit
 * upstream identity in both agent and complete-generation SBOMs. */
export function vendoredSbomPackages(closure) {
  return (closure.vendoredComponents ?? []).map(component => ({
    SPDXID: `SPDXRef-vendored-${component.name.replace(/[^A-Za-z0-9.-]/gu, "-")}`,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: `${component.repository}/tree/${component.commit}`,
    filesAnalyzed: false,
    supplier: "NOASSERTION",
    checksums: [],
    licenseConcluded: "NOASSERTION",
    licenseDeclared: component.license,
    sourceInfo: `Vendored native port; upstream commit ${component.commit}; port ${component.portVersion}; license ${component.licensePath}`,
    comment: component.scope,
  }));
}
