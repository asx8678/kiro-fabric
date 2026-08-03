export interface NormalizedAiRequest { instruction: string; context: string; role: "planner" | "worker" | "verifier" | "general"; model?: string; schema?: Record<string, unknown>; maxOutputChars: number; timeoutMs: number; repair?: boolean }
export interface RawAiRunnerResult { stdout: string; stderr: string; exitCode: number; elapsedMs: number; model?: string }
export interface RunnerDoctorResult { ok: boolean; name: string; version?: string; message?: string }
export interface ModelInfo { id: string; name?: string; description?: string }
export interface AiRunner { readonly name: string; doctor(): Promise<RunnerDoctorResult>; listModels?(): Promise<ModelInfo[]>; run(request: NormalizedAiRequest, signal?: AbortSignal): Promise<RawAiRunnerResult> }