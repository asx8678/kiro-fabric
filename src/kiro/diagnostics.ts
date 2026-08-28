export const neverNativeTranscriptOK = true as const;

export type KiroFeatureSupport = "qualified";

export type KiroFeatureName =
  | "mcp federation"
  | "memory"
  | "topology"
  | "semantic handoff"
  | "agents"
  | "workflows";

export interface KiroFeatureDiagnosticRow {
  feature: KiroFeatureName;
  supported: KiroFeatureSupport;
  diagnostic: string;
}

export const kiroParsiveFidelity = (): "semantic" => "semantic";

const FEATURE_ROWS: readonly KiroFeatureDiagnosticRow[] = [
  { feature: "mcp federation", supported: "qualified", diagnostic: "Managed Kiro mounts an on-demand, approval-gated MCP facade without contacting servers during discovery." },
  { feature: "memory", supported: "qualified", diagnostic: "Managed Kiro provides bounded project memory outside the repository; it does not read Kiro's private transcript store." },
  { feature: "topology", supported: "qualified", diagnostic: "Managed Kiro provides explicit lightweight topology records and fenced leases without private session reads." },
  { feature: "semantic handoff", supported: "qualified", diagnostic: "Kiro ACP children receive a bounded semantic context packet; native transcript fidelity is never claimed." },
  { feature: "agents", supported: "qualified", diagnostic: "Trusted opt-in enables at most four non-recursive Kiro ACP children with scoped verification tools." },
  { feature: "workflows", supported: "qualified", diagnostic: "Managed Kiro exposes runtime-local parallel, pipeline, phase, item, event, log, and budget workflow helpers." },
] as const;

export const kiroFeatureDiagnostics = (): KiroFeatureDiagnosticRow[] =>
  FEATURE_ROWS.map((row) => ({ ...row }));
