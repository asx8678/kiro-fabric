export const REAL_CLIENT_SESSION_COMMAND = ["kiro-cli", "--v3"];
export const REAL_CLIENT_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
export const REAL_CLIENT_NATIVE_CAPABILITIES = ["file-read", "file-edit", "shell", "web", "subagent"];
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const assertRealClientEvidence = (report, packageDigest, options = {}) => {
  if (!report || typeof report !== "object") throw new Error("real-client evidence must be an object");
  if (options.qualification === true && (
    report.kind !== "kiro-fabric.real-client-qualification" || report.schemaVersion !== 2 || report.ok !== true
  )) throw new Error("real-client qualification identity is invalid");
  if (report.packageDigest !== packageDigest || !SHA256.test(report.packageDigest) ||
      !equal(report.sessionCommand, REAL_CLIENT_SESSION_COMMAND) || report.powerActivated !== true ||
      !equal(report.tools, REAL_CLIENT_TOOLS) || report.customAgentSelected !== false) {
    throw new Error("real-client evidence is incomplete or not bound to the exact packaged contract");
  }
  if (options.archiveDigest && report.archiveDigest !== options.archiveDigest) throw new Error("real-client evidence is not bound to the exact release archive");
  if (!SHA256.test(report.archiveDigest ?? "") || !GIT_OBJECT_ID.test(report.commit ?? "") ||
      !SHA256.test(report.driver?.digest ?? "") || typeof report.driver?.version !== "string" ||
      !SHA256.test(report.kiro?.digest ?? "") || typeof report.kiro?.version !== "string" || typeof report.kiro?.path !== "string") {
    throw new Error("real-client binary, driver, archive, or commit identity is incomplete");
  }
  if (!equal(report.nativeCapabilities, REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })))) {
    throw new Error("native Kiro capabilities were not all observed by the real client");
  }
  if (!Array.isArray(report.transcript) || report.transcript.length < 3 || report.transcript.length > 256 ||
      JSON.stringify(report.transcript).length > 512_000 ||
      !["power-activation", "mcp-tools-list", "native-capability-probes"].every((kind) => report.transcript.some((entry) => entry?.kind === kind && SHA256.test(entry.digest ?? "")))) {
    throw new Error("real-client transcript is missing bounded observed evidence");
  }
  return report;
};
