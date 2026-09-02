export const REAL_CLIENT_SESSION_COMMAND = ["kiro-cli", "--v3"];
export const REAL_CLIENT_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const assertRealClientEvidence = (report, packageDigest, options = {}) => {
  if (!report || typeof report !== "object") throw new Error("real-client evidence must be an object");
  if (options.qualification === true && (
    report.kind !== "kiro-fabric.real-client-qualification" ||
    report.schemaVersion !== 1 ||
    report.ok !== true
  )) {
    throw new Error("real-client qualification identity is invalid");
  }
  if (
    report.packageDigest !== packageDigest ||
    !equal(report.sessionCommand, REAL_CLIENT_SESSION_COMMAND) ||
    report.powerActivated !== true ||
    !equal(report.tools, REAL_CLIENT_TOOLS) ||
    report.customAgentSelected !== false
  ) {
    throw new Error("real-client evidence is incomplete or not bound to the exact packaged contract");
  }
  return report;
};
