export interface DevelopmentProfileValidation {
  root: string;
  profilePath: string;
  profile: Record<string, unknown>;
  server: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

export interface KiroValidatorCommand {
  command: string;
  args?: string[];
}

export function validateDevelopmentProfile(root?: string): DevelopmentProfileValidation;
export function runKiroAgentValidator(command: KiroValidatorCommand, profilePath: string): string;
export function validateWithInstalledKiro(
  profilePath: string,
  binary?: string,
  required?: boolean,
):
  | { status: "unavailable"; reason: string }
  | { status: "passed"; version: string; output: string };
export function smokeDevelopmentMcp(root?: string): Promise<{
  tools: string[];
  result: string;
}>;
