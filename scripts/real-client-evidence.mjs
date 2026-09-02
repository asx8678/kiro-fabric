import { createHash } from "node:crypto";

export const REAL_CLIENT_SESSION_COMMAND = ["kiro-cli", "--v3"];
export const REAL_CLIENT_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
export const REAL_CLIENT_NATIVE_CAPABILITIES = ["file-read", "file-edit", "shell", "web", "subagent"];
export const REAL_CLIENT_TRANSCRIPT_KINDS = ["kiro-version", "power-activation", "mcp-tools-list", "native-capability-probes"];
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const transcriptEntry = (kind, bytes) => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { kind, encoding: "base64", bytes: buffer.length, digest: digest(buffer), raw: buffer.toString("base64") };
};

const verifyTranscript = (entries) => {
  if (!Array.isArray(entries) || entries.length !== REAL_CLIENT_TRANSCRIPT_KINDS.length) throw new Error("real-client transcript is incomplete");
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.kind !== REAL_CLIENT_TRANSCRIPT_KINDS[index] || entry.encoding !== "base64" || typeof entry.raw !== "string") throw new Error("real-client transcript identity is invalid");
    const bytes = Buffer.from(entry.raw, "base64");
    if (bytes.toString("base64") !== entry.raw || bytes.length !== entry.bytes || bytes.length > 128_000 || digest(bytes) !== entry.digest) throw new Error("real-client transcript digest is invalid");
    total += bytes.length;
  }
  if (total > 512_000) throw new Error("real-client transcript exceeds its byte budget");
};

export const assertRealClientEvidence = (report, packageDigest, options = {}) => {
  if (!report || typeof report !== "object") throw new Error("real-client evidence must be an object");
  if (options.qualification === true && (report.kind !== "kiro-fabric.real-client-qualification" || report.schemaVersion !== 3 || report.ok !== true)) throw new Error("real-client qualification identity is invalid");
  if (report.packageDigest !== packageDigest || !SHA256.test(report.packageDigest) || !equal(report.sessionCommand, REAL_CLIENT_SESSION_COMMAND) || report.powerActivated !== true || !equal(report.tools, REAL_CLIENT_TOOLS) || report.customAgentSelected !== false) throw new Error("real-client evidence is incomplete or not bound to the exact packaged contract");
  if (!options.archiveDigest || report.archiveDigest !== options.archiveDigest || !SHA256.test(report.archiveDigest)) throw new Error("real-client evidence is not bound to the exact release archive");
  if (!options.commit || report.commit !== options.commit || !GIT_OBJECT_ID.test(report.commit)) throw new Error("real-client evidence is not bound to the exact commit");
  if (!SHA256.test(report.driver?.digest ?? "") || typeof report.driver?.version !== "string" || !SHA256.test(report.kiro?.digest ?? "") || typeof report.kiro?.version !== "string" || typeof report.kiro?.path !== "string") throw new Error("real-client binary or driver identity is incomplete");
  if (!equal(report.nativeCapabilities, REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })))) throw new Error("native Kiro capabilities were not all observed by the real client");
  verifyTranscript(report.transcript);
  return report;
};
