export interface NormalizedAiRequest {
  instruction: string;
  context: string;
  role: "planner" | "worker" | "verifier" | "general";
  model?: string;
  schema?: Record<string, unknown>;
  maxOutputChars: number;
  timeoutMs: number;
  repair?: boolean;
}
export type ModelResolutionSource = "kiro-metadata" | "runner" | "unknown";
export interface RawAiRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
  /** Actual token usage reported by the runner; when absent, tokens are estimated as ceil(chars / 4). */
  usage?: { input: number; output: number };
  /** @deprecated Ambiguous legacy field; never treated as a resolved ID. */ model?: string;
  requestedModel?: string;
  resolvedModel?: string;
  resolutionSource?: ModelResolutionSource;
}
export interface RunnerDoctorResult {
  ok: boolean;
  name: string;
  version?: string;
  message?: string;
}
export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
}
export interface AiRunner {
  readonly name: string;
  doctor(): Promise<RunnerDoctorResult>;
  listModels?(): Promise<ModelInfo[]>;
  run(request: NormalizedAiRequest, signal?: AbortSignal): Promise<RawAiRunnerResult>;
}
