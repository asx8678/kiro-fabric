import type { FabricActionDescriptor } from "../protocol.js";

export type ProbeKind = "repository-code" | "framework-semantic" | "illustrative";
export type ProbeVersionDeclaration = { name: string; version: string };
/** Claims supplied by the caller, never SDK detection, environment injection, or source verification. */
export type ProbeDeclarations = {
  sdkVersions?: ProbeVersionDeclaration[];
  packageVersions?: ProbeVersionDeclaration[];
  environment?: { name: string; value: string }[];
  sourceReferences?: { path: string; sha256?: string; note?: string }[];
};
export type ProbeFile = { path: string; content: string };
export type ProbeCreateArguments = { label?: string; kind: ProbeKind; files?: ProbeFile[]; declarations?: ProbeDeclarations };
export type ProbeWriteArguments = { id: string; path: string; content: string };
export type ProbeRunArguments = { id: string; args?: string[]; timeoutMs?: number; settle?: boolean; declarations?: ProbeDeclarations } & (
  { script: string; interpreter?: "sh" | "bash"; executable?: never } |
  { executable: string; script?: never; interpreter?: never }
);
export type ProbeHandle = { id: string; kind: ProbeKind; cwd: string; manifestPath: string; retained: true; productionProof: false };
export type ProbeWriteResult = { id: string; path: string; sha256: string; bytes: number; recordPath: string; retained: true };
export type ProbeRunResult = {
  id: string; runId: string; kind: ProbeKind; productionProof: false; recordPath: string;
  ok: boolean; exitCode: number | null; signal: string | null;
  stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean;
};
export type ProbeDiscoveryResult = {
  executables: { name: string; path: string; source: "PATH" | "conventional-sdk"; exists: boolean; executableFile: boolean }[];
  caches: { path: string; exists: boolean }[];
  truncated: boolean; executed: false; versionsObserved: false; credentialsAssumed: false;
};
export interface ProbeProviderOptions {
  root: string;
  /** Canonical absolute runtime-owned path outside (and not containing) the repository.
   * May be absent; constructor/preparation/reservation never create it. */
  probesRoot: string;
  maxResultChars?: number;
  maxProbes?: number;
  maxRunsPerProbe?: number;
  maxWritesPerProbe?: number;
  maxManagedBytesPerProbe?: number;
  /** Host-only deterministic discovery inputs; never used as the execution environment. */
  discoveryEnvironment?: { PATH?: string; HOME?: string; DOTNET_ROOT?: string };
  /** Host-only additional bounded SDK bin directories, not recursive scans. */
  sdkDirectories?: string[];
}

// The host bounded validator rejects schema DAGs, patterns and combinators.
// Clone property reuse into trees; procedural validation enforces UUIDs/unions.
const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => JSON.parse(JSON.stringify({ type: "object", properties, required, additionalProperties: false })) as Record<string, unknown>;
const text = (maxLength: number, minLength = 0) => ({ type: "string", minLength, maxLength });
const array = (items: Record<string, unknown>, maxItems: number) => ({ type: "array", items, maxItems });
const bool = { type: "boolean" };
const id = text(36, 36);
const kind = { enum: ["repository-code", "framework-semantic", "illustrative"] };
const declarations = object({
  sdkVersions: array(object({ name: text(128, 1), version: text(256, 1) }, ["name", "version"]), 16),
  packageVersions: array(object({ name: text(128, 1), version: text(256, 1) }, ["name", "version"]), 32),
  environment: array(object({ name: text(128, 1), value: text(1024) }, ["name", "value"]), 16),
  sourceReferences: array(object({ path: text(1024, 1), sha256: text(64, 64), note: text(1024) }, ["path"]), 16),
});
export const PROBE_INPUT_SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = {
  discover: object({ executables: { ...array(text(64, 1), 16), minItems: 1 } }, ["executables"]),
  create: object({ label: text(160), kind, files: array(object({ path: text(240, 1), content: text(32768) }, ["path", "content"]), 16), declarations }, ["kind"]),
  write: object({ id, path: text(240, 1), content: text(32768) }, ["id", "path", "content"]),
  run: object({ id, script: text(16000, 1), executable: text(4096, 1), interpreter: { enum: ["sh", "bash"] }, args: array(text(4096), 64), timeoutMs: { type: "integer", minimum: 1, maximum: 900000 }, settle: bool, declarations }, ["id"]),
};
const outputs: Record<string, Record<string, unknown>> = {
  discover: object({ executables: array(object({ name: text(64), path: text(4096), source: { enum: ["PATH", "conventional-sdk"] }, exists: bool, executableFile: bool }, ["name", "path", "source", "exists", "executableFile"]), 640), caches: array(object({ path: text(4096), exists: bool }, ["path", "exists"]), 8), truncated: bool, executed: { const: false }, versionsObserved: { const: false }, credentialsAssumed: { const: false } }, ["executables", "caches", "truncated", "executed", "versionsObserved", "credentialsAssumed"]),
  create: object({ id, kind, cwd: text(4096), manifestPath: text(4096), retained: { const: true }, productionProof: { const: false } }, ["id", "kind", "cwd", "manifestPath", "retained", "productionProof"]),
  write: object({ id, path: text(240), sha256: text(64), bytes: { type: "integer", minimum: 0 }, recordPath: text(4096), retained: { const: true } }, ["id", "path", "sha256", "bytes", "recordPath", "retained"]),
  run: object({ id, runId: id, kind, productionProof: { const: false }, recordPath: text(4096), ok: bool, exitCode: { type: ["integer", "null"] }, signal: { type: ["string", "null"] }, stdout: text(20000), stderr: text(20000), truncated: bool, stdoutTruncated: bool, stderrTruncated: bool }, ["id", "runId", "kind", "productionProof", "recordPath", "ok", "exitCode", "signal", "stdout", "stderr", "truncated", "stdoutTruncated", "stderrTruncated"]),
};
const descriptions: Record<string, string> = {
  discover: "Read-only bounded PATH/conventional SDK presence and cache location checks. No commands, version detection, cache contents, installs, or credential assumptions. executableFile means a regular X_OK candidate, not a successful launch or usable SDK. Absence is limited to searched candidates.",
  create: "Explicit approved fresh independent retained project outside the repository. Caller declares provenance kind/versions/source references, never production proof. No copying, installs, automatic tests, or deletion. IDs are host-owned and usable only by this provider instance.",
  write: "Explicit individually approved create-only UTF-8 file in a retained owned probe project. Safe relative paths; no overwrite or deletion. Missing project subdirectories are created after approval.",
  run: "Explicit approved HOST execution in this probe's owned project cwd using runLocalShell. Not filesystem/network confinement; no injected environment or implicit installs/tests/reruns. Literal scripts preserve the shell's last exit (no arbitrary pipeline parsing); executable+args uses a positional exec wrapper. Retains separate request/result records. settle catches only ordinary nonzero exits, never timeout/cancellation/abnormal termination. Quotas cover provider-managed data, not shell effects.",
};
/** Runtime-specific effect resources are applied by ProbeProvider. JSON trees, including across descriptors. */
export const PROBE_ACTION_DESCRIPTORS: readonly FabricActionDescriptor[] = JSON.parse(JSON.stringify(Object.entries(PROBE_INPUT_SCHEMAS).map(([name, inputSchema]) => ({
  name, description: descriptions[name],
  inputSchema: name === "discover" ? inputSchema : { ...inputSchema, properties: { ...(inputSchema.properties as Record<string, unknown>), _probePreparation: object({ token: id, id, operationId: id, cwd: text(4096), recordPath: text(4096) }, ["token", "id", "operationId", "cwd", "recordPath"]), review: text(4096) } },
  outputSchema: outputs[name], risk: name === "run" ? "execute" : name === "discover" ? "read" : "write",
  effect: { kind: name === "discover" ? "read" : "write", resources: ["*"] },
})))) as FabricActionDescriptor[];

/** Mount as `probe`; append to checked guest declarations. No host options/preparation fields exposed. */
export const PROBE_GUEST_DECLARATIONS = `
type ProbeKind = "repository-code" | "framework-semantic" | "illustrative";
type ProbeDeclarations = { sdkVersions?: {name:string;version:string}[]; packageVersions?: {name:string;version:string}[]; environment?: {name:string;value:string}[]; sourceReferences?: {path:string;sha256?:string;note?:string}[] };
type ProbeHandle = {id:string;kind:ProbeKind;cwd:string;manifestPath:string;retained:true;productionProof:false};
type ProbeWriteResult = {id:string;path:string;sha256:string;bytes:number;recordPath:string;retained:true};
type ProbeRunResult = {id:string;runId:string;kind:ProbeKind;productionProof:false;recordPath:string;ok:boolean;exitCode:number|null;signal:string|null;stdout:string;stderr:string;truncated:boolean;stdoutTruncated:boolean;stderrTruncated:boolean};
type ProbeDiscoveryResult = {executables:{name:string;path:string;source:"PATH"|"conventional-sdk";exists:boolean;executableFile:boolean}[];caches:{path:string;exists:boolean}[];truncated:boolean;executed:false;versionsObserved:false;credentialsAssumed:false};
declare const probe: {
  /** Presence-only, <=16 names; <=32 absolute PATH entries and <=8 conventional SDK directories. No execution/credential assumption. */
  discover(args:{executables:string[]}):Promise<ProbeDiscoveryResult>;
  /** Explicit approved independent retained project; declarations are unverified caller claims. IDs are instance-owned, not paths. */
  create(args:{label?:string;kind:ProbeKind;files?:{path:string;content:string}[];declarations?:ProbeDeclarations}):Promise<ProbeHandle>;
  /** Individually approved create-only file, safe relative path; no deletion/overwrite. */
  write(args:{id:string;path:string;content:string}):Promise<ProbeWriteResult>;
  /** Approved HOST authority, not network/filesystem isolation. No inferred tests/installs/reruns. Literal script returns shell last exit; executable+args execs directly. settle never catches hard failure. */
  run(args:{id:string;args?:string[];timeoutMs?:number;settle?:boolean;declarations?:ProbeDeclarations}&({script:string;interpreter?:"sh"|"bash";executable?:never}|{executable:string;script?:never;interpreter?:never})):Promise<ProbeRunResult>;
};
`;
